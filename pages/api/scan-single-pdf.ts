import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';
import vision from '@google-cloud/vision';
import OpenAI from 'openai';
import { franc } from 'franc';
import pdf from 'pdf-parse';
import { createAuthenticatedClient } from '../../services/createAuthenticatedClient';
import { getAdminClient } from '../../services/supabaseAdmin';
import { readCleanFile, UploadError } from '../../services/secureFiles';
import { requireAppUser } from '../../services/requireAppUser';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8kb', // the body is only { fileId }; the PDF itself comes from the clean store
    }
  },
};

// Initialize clients (reuse from scan-form.ts)
const visionClient = new vision.ImageAnnotatorClient({
  credentials: (() => {
    const creds = JSON.parse(process.env.GOOGLE_VISION!);
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    return creds;
  })(),
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// The PDF was checked and rebuilt clean by /api/files/finalize. Read that copy, as the caller.
async function downloadFile(fileId: string, token: string): Promise<string> {
  const admin = getAdminClient();
  if (!admin) throw new UploadError(503, 'not_configured');
  const { data, mime } = await readCleanFile({ admin, userClient: createAuthenticatedClient(token), fileId, kind: 'scan' });
  if (mime !== 'application/pdf') throw new UploadError(400, 'unsupported_type');
  const tmpFile = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, data);
  return tmpFile;
}

async function extractTextFromPdf(pdfPath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    
    // Extract text from first few pages (approximately)
    const text = data.text;
    const pages = text.split('\n\n\f\n\n'); // PDF page breaks
    const firstPages = pages.slice(0, 3).join('\n\n');
    
    return firstPages;
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw error;
  }
}

async function processText(text: string): Promise<any> {
  const langCode = franc(text);
  const detectedLanguage = langCode === 'ara' ? 'ar' : 'en';

  const promptPath = path.join(process.cwd(), 'public', 'locales', detectedLanguage, 'pdf-prompts.json');
  const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
  const prompt = promptData.prompt.replace('${cleanedText}', text);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Extract a single form from the text. Return a JSON object with the form data including ERR ID, date, expenses, and financial summary.'
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    return JSON.parse(content);
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw error;
  }
}

function transformFormData(openAIResponse: any) {
  return {
    date: openAIResponse.date || '',
    err_id: openAIResponse.err_id || '',
    expenses: openAIResponse.expenses || [],
    financial_summary: {
      total_expenses: openAIResponse.financial_summary?.total_expenses || '',
      total_grant_received: openAIResponse.financial_summary?.total_grant_received || '',
      total_other_sources: openAIResponse.financial_summary?.total_other_sources || '',
      remainder: openAIResponse.financial_summary?.remainder || ''
    },
    additional_questions: {
      excess_expenses: openAIResponse.additional_questions?.excess_expenses || '',
      surplus_use: openAIResponse.additional_questions?.surplus_use || '',
      lessons_learned: openAIResponse.additional_questions?.lessons_learned || '',
      training_needs: openAIResponse.additional_questions?.training_needs || ''
    }
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Signed-in, active app users only (this route calls paid AI services or writes reports)
  const caller = await requireAppUser(req, res);
  if (!caller) return;

  let filePath: string | null = null;
  
  try {
    const { fileId } = req.body || {};
    if (typeof fileId !== 'string' || !fileId) {
      return res.status(400).json({ error: 'No file provided' });
    }

    filePath = await downloadFile(fileId, caller.token);

    const extractedText = await extractTextFromPdf(filePath);
    const structuredData = await processText(extractedText);

    return res.status(200).json({ 
      message: 'PDF processed successfully', 
      data: structuredData
    });

  } catch (error: any) {
    if (error instanceof UploadError) return res.status(error.status).json({ error: error.code, code: error.code });
    console.error('Processing error:', error?.message);
    res.status(500).json({ error: 'Error processing PDF' });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
} 