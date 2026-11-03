// components/ui/SignaturePad.tsx
// A box to sign in with a finger (or mouse). Black ink on white; hands back a PNG data URL.
// Used for the F3 (MOU) signatures of the room's program and finance officers.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

export interface SignaturePadHandle {
    clear: () => void;
    /** True until enough has been drawn to count as a signature (not a stray tap). */
    isEmpty: () => boolean;
    /** PNG data URL, at most 800px wide, or null when empty. */
    toDataURL: () => string | null;
}

interface Props {
    height?: number;
    onChange?: (empty: boolean) => void;
    ariaLabel?: string;
}

const MIN_INK = 40; // px of line drawn before it counts as a signature
const INK = '#111827';

const SignaturePad = forwardRef<SignaturePadHandle, Props>(({ height = 180, onChange, ariaLabel }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const ink = useRef(0);
    const reported = useRef(true);

    const report = useCallback((empty: boolean) => {
        if (reported.current !== empty) {
            reported.current = empty;
            onChange?.(empty);
        }
    }, [onChange]);

    const ctx = () => canvasRef.current?.getContext('2d') || null;

    const setup = useCallback(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const w = c.offsetWidth || 320;
        c.width = Math.round(w * ratio);
        c.height = Math.round(height * ratio);
        const g = c.getContext('2d');
        if (!g) return;
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, height);
        g.lineWidth = 2.5;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = INK;
        ink.current = 0;
        reported.current = false; // force the next report through
        report(true);
    }, [height, report]);

    useEffect(() => { setup(); }, [setup]);

    useImperativeHandle(ref, () => ({
        clear: setup,
        isEmpty: () => ink.current < MIN_INK,
        toDataURL: () => {
            const c = canvasRef.current;
            if (!c || ink.current < MIN_INK) return null;
            const scale = Math.min(1, 800 / c.width);
            if (scale === 1) return c.toDataURL('image/png');
            const out = document.createElement('canvas');
            out.width = Math.round(c.width * scale);
            out.height = Math.round(c.height * scale);
            const g = out.getContext('2d');
            if (!g) return c.toDataURL('image/png');
            g.drawImage(c, 0, 0, out.width, out.height);
            return out.toDataURL('image/png');
        },
    }), [setup]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const p = point(e);
        last.current = p;
        const g = ctx();
        if (g) {
            g.beginPath();
            g.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
            g.fillStyle = INK;
            g.fill();
        }
    };

    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current || !last.current) return;
        e.preventDefault();
        const p = point(e);
        const g = ctx();
        if (g) {
            g.beginPath();
            g.moveTo(last.current.x, last.current.y);
            g.lineTo(p.x, p.y);
            g.stroke();
        }
        ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
        last.current = p;
        if (ink.current >= MIN_INK) report(false);
    };

    const onUp = () => {
        drawing.current = false;
        last.current = null;
    };

    return (
        <div dir="ltr" className="rounded-xl border-2 border-dashed border-gray-300 bg-white overflow-hidden">
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={ariaLabel}
                style={{ width: '100%', height, touchAction: 'none', display: 'block', cursor: 'crosshair' }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={onUp}
            />
        </div>
    );
});

SignaturePad.displayName = 'SignaturePad';
export default SignaturePad;
