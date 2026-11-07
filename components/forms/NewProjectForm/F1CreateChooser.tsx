import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ChevronRight } from 'lucide-react';
import { HomeCard } from '../../home/HomeSection';
import { WorkPlanScene, ReportingScene } from '../../home/illustrations';
import F1ScopeFields, { emptyF1Scope, F1ScopeValue, scopeIsReady } from './F1ScopeFields';

type F1CreateChooserProps = {
  onBack: () => void;
  onChooseManual: (scope: F1ScopeValue) => void;
  onChooseOcr: () => void;
};

export default function F1CreateChooser({
  onBack,
  onChooseManual,
  onChooseOcr,
}: F1CreateChooserProps) {
  const { t: tx } = useTranslation('app');
  const router = useRouter();
  const [step, setStep] = useState<'method' | 'manual-scope'>('method');
  const [scope, setScope] = useState<F1ScopeValue>(emptyF1Scope);
  const [scopeError, setScopeError] = useState<string | null>(null);

  if (step === 'manual-scope') {
    return (
      <div>
        <div className="mb-6">
          <p className="app-section-label mb-1">{tx('x.f1ManualEntry')}</p>
          <h2 className="text-xl font-bold text-white leading-snug mb-1">{tx('x.scope')}</h2>
          <p className="text-sm text-[#a8b6cc] mb-0">
            {tx('x.chooseGrantSegment')}{scope.emergency_room_id ? '' : ', state and ERR'}{tx('x.thenContinueToTheForm')}
          </p>
        </div>

        <div className="mb-6">
          <F1ScopeFields value={scope} onChange={setScope} locale={router.locale || 'en'} compact />
        </div>

        {scopeError && (
          <div className="mb-4 rounded-xl bg-red-500/10 border border-red-400/30 text-red-300 px-3 py-2 text-sm">
            {scopeError}
          </div>
        )}

        <button
          type="button"
          className="app-action-primary"
          onClick={() => {
            if (!scopeIsReady(scope)) {
              setScopeError(tx('x.selectGrantSegmentAndErrRoom'));
              return;
            }
            setScopeError(null);
            onChooseManual(scope);
          }}
        >
          {tx('x.continueToForm')}
        </button>

        <button
          type="button"
          onClick={() => setStep('method')}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#8a97ab] hover:text-brand-orange"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
          {tx('x.back')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="app-section-label mb-1">{tx('x.f1WorkPlans')}</p>
        <h2 className="text-xl font-bold text-white leading-snug mb-1">{tx('x.createAnF1')}</h2>
        <p className="text-sm text-[#a8b6cc] mb-0">
          {tx('x.uploadACompletedFormOrFill')}
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto pb-2 scrollbar-none mb-4">
        <div className="flex w-max min-w-full gap-3 px-4 snap-x snap-mandatory items-stretch">
          <HomeCard
            onClick={onChooseOcr}
            code={tx('x.ai')}
            title={tx('x.uploadWithAi')}
            subtitle={tx('x.pdfOrWordForm')}
            illustration={ReportingScene}
            wash="bg-[#7B96C4]"
            size="md"
          />
          <HomeCard
            onClick={() => setStep('manual-scope')}
            code={tx('x.manual')}
            title={tx('x.manualEntry')}
            subtitle={tx('x.fillTheF1FormYourself')}
            illustration={WorkPlanScene}
            wash="bg-brand-orangeSoft"
            size="md"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-[#8a97ab] hover:text-brand-orange"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        {tx('x.backToDrafts')}
      </button>
    </div>
  );
}
