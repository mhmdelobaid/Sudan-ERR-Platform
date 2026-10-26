// Small arithmetic evaluator for the calculator screen (replaces eval(), audit L1, 26 Oct 2026).
// Understands only numbers, + - * / and a leading minus or plus, with the usual order (* and / before + and -).
// Anything else (letters, brackets, two dots in a number, a trailing operator) throws, and the
// calculator shows "Error", as it did before. It never runs code.

export function calculate(input: string): number {
    const s = input.replace(/\s+/g, '');
    let i = 0;

    const fail = (): never => { throw new Error('invalid_expression'); };

    function number(): number {
        const start = i;
        let dots = 0;
        while (i < s.length && /[0-9.]/.test(s[i])) {
            if (s[i] === '.') dots += 1;
            i += 1;
        }
        const text = s.slice(start, i);
        if (!text || text === '.' || dots > 1) fail();
        return Number(text);
    }

    function factor(): number {
        if (s[i] === '-') { i += 1; return -factor(); }
        if (s[i] === '+') { i += 1; return factor(); }
        return number();
    }

    function term(): number {
        let v = factor();
        while (s[i] === '*' || s[i] === '/') {
            const op = s[i]; i += 1;
            const r = factor();
            v = op === '*' ? v * r : v / r;
        }
        return v;
    }

    function expr(): number {
        let v = term();
        while (s[i] === '+' || s[i] === '-') {
            const op = s[i]; i += 1;
            const r = term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    }

    if (!s) fail();
    const value = expr();
    if (i !== s.length) fail();
    return value;
}
