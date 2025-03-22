// deno-lint-ignore-file no-explicit-any
import type { ObjectType } from "./context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Evaluator = (envars: any) => unknown;

enum TokenType {
    NUMBER = "n",
    STRING = "s",
    BOOLEAN = "b",
    NEGATION = "-N",
    POSITIVE = "+N",
    DOT = ".",
    NOT = "!",
    BNOT = "~",
    GT = ">",
    GE = ">=",
    EQ = "==",
    NEQ = "!=",
    LT = "<",
    LE = "<=",
    ADD = "+",
    SUB = "-",
    MUL = "*",
    DIV = "/",
    MOD = "%",
    QUESTION = "?",
    COLON = ":",
    AND = "&&",
    OR = "||",
    BAND = "&",
    BOR = "|",
    BXOR = "^",
    SHL = "<<",
    SHR = ">>",
    SHRU = ">>>",
    LPAREN = "(",
    RPAREN = ")",
}

type Token = {
    type: TokenType;
    value?: string | number | boolean | null;
};

const OP_REGEX = /^(!|<<|>>>|>>|>=|<=|==|!=|>|<|&&|&|\|\||\||\^|\?|:|\.|[-+*%/()])/;
const NUMBER_REGEX = /^(\d+\.\d+|\d+)/;
const WORD_REGEX = /^(\w+)/;

export class ExpressionEvaluator {
    private _postfix: Token[];
    private _args: ObjectType | null = null;
    private _expr: string;

    constructor(expression: string) {
        this._expr = expression.replace(/\s/g, "");
        this._postfix = this._convertToPostfix(this._parse(this._expr));
    }

    private _parse(expr: string) {
        const tokens: string[] = [];
        while (expr.length) {
            const char = expr[0];
            let token: RegExpMatchArray | null = null;
            if (/^\d/.test(char)) {
                token = expr.match(NUMBER_REGEX);
            } else if (/^\w/.test(char)) {
                token = expr.match(WORD_REGEX);
            } else if (/^[-+*%/()<>=?&|:^.!]/.test(char)) {
                token = expr.match(OP_REGEX);
            }
            if (!token) {
                throw new Error(`Invalid expression: '${expr}' in '${this._expr}'`);
            }
            tokens.push(token[1]);
            expr = expr.slice(token[1].length);
        }
        return tokens;
    }

    evaluate(args: ObjectType): unknown {
        const stack: unknown[] = [];

        this._args = args;
        for (const token of this._postfix) {
            const type = token.type;
            if (
                type === TokenType.NUMBER ||
                type === TokenType.BOOLEAN ||
                type === TokenType.STRING
            ) {
                stack.push(token.value);
            } else if (type === TokenType.QUESTION) {
                const condition = stack.pop()!;
                const trueValue = stack.pop()!;
                const falseValue = stack.pop()!;
                stack.push(this._toValue<unknown>(condition, false) ? trueValue : falseValue);
            } else if (type === TokenType.POSITIVE) {
                stack.push(this._toValue(stack.pop()!, false));
            } else if (type === TokenType.NEGATION) {
                stack.push(-this._toValue(stack.pop()!, false));
            } else if (type === TokenType.NOT) {
                stack.push(!this._toValue(stack.pop()!, false));
            } else if (type === TokenType.BNOT) {
                stack.push(~this._toValue(stack.pop()!, false));
            } else {
                const b = stack.pop()!;
                const a = stack.pop()!;
                switch (type) {
                    case TokenType.DOT: {
                        const obj = this._toObject(a);
                        stack.push(this._toValue(obj[b as string]));
                        break;
                    }
                    case TokenType.GT:
                        stack.push(this._toValue(a) > this._toValue(b));
                        break;
                    case TokenType.GE:
                        stack.push(this._toValue(a) >= this._toValue(b));
                        break;
                    case TokenType.EQ:
                        stack.push(
                            this._toValue<unknown>(a, false) === this._toValue<unknown>(b, false)
                        );
                        break;
                    case TokenType.NEQ:
                        stack.push(
                            this._toValue<unknown>(a, false) !== this._toValue<unknown>(b, false)
                        );
                        break;
                    case TokenType.LT:
                        stack.push(this._toValue(a) < this._toValue(b));
                        break;
                    case TokenType.LE:
                        stack.push(this._toValue(a) <= this._toValue(b));
                        break;
                    case TokenType.ADD:
                        stack.push(this._toValue(a) + this._toValue(b));
                        break;
                    case TokenType.SUB:
                        stack.push(this._toValue(a) - this._toValue(b));
                        break;
                    case TokenType.MUL:
                        stack.push(this._toValue(a) * this._toValue(b));
                        break;
                    case TokenType.DIV:
                        stack.push(this._toValue(a) / this._toValue(b));
                        break;
                    case TokenType.MOD:
                        stack.push(this._toValue(a) % this._toValue(b));
                        break;
                    case TokenType.COLON: {
                        stack.push(this._toValue(a));
                        stack.push(this._toValue(b));
                        break;
                    }
                    case TokenType.SHL:
                        stack.push(this._toValue(a) << this._toValue(b));
                        break;
                    case TokenType.SHR:
                        stack.push(this._toValue(a) >> this._toValue(b));
                        break;
                    case TokenType.SHRU:
                        stack.push(this._toValue(a) >>> this._toValue(b));
                        break;
                    case TokenType.BAND:
                        stack.push(this._toValue(a) & this._toValue(b));
                        break;
                    case TokenType.BOR:
                        stack.push(this._toValue(a) | this._toValue(b));
                        break;
                    case TokenType.BXOR:
                        stack.push(this._toValue(a) ^ this._toValue(b));
                        break;
                    case TokenType.AND:
                        stack.push(this._toValue(a) && this._toValue(b));
                        break;
                    case TokenType.OR:
                        stack.push(this._toValue(a) || this._toValue(b));
                        break;
                    default:
                        throw new Error(`unsupport operator: ${type}`);
                }
            }
        }

        this._args = null;

        return stack.pop();
    }

    private _toObject(token: unknown) {
        if (typeof token === "string") {
            const obj = this._args?.[token];
            if (typeof obj === "object") {
                return obj as ObjectType;
            } else {
                throw new Error(`value indexed by '${token}' is not a object`);
            }
        } else {
            throw new Error(`token '${token}' is not a string`);
        }
    }

    private _toValue<T = number>(token: unknown, isNumber: boolean = true): T {
        const type = typeof token;
        if (type === "number" || type === "boolean" || token === null) {
            return token as T;
        } else if (typeof token === "string") {
            const value = this._args?.[token];
            if (value === undefined) {
                throw new Error(`value indexed by '${token}' is not found`);
            } else if (isNumber && typeof value !== "number") {
                throw new Error(`value indexed by '${token}' is not a number'`);
            }
            return value as T;
        } else {
            throw new Error(`token '${token}' type not support!`);
        }
    }

    private _precedence(operator: string): number {
        switch (operator) {
            case TokenType.DOT:
                return 18;
            case TokenType.NEGATION:
            case TokenType.POSITIVE:
            case TokenType.NOT:
            case TokenType.BNOT:
                return 15;
            case TokenType.MOD:
            case TokenType.MUL:
            case TokenType.DIV:
                return 13;
            case TokenType.ADD:
            case TokenType.SUB:
                return 12;
            case TokenType.SHL:
            case TokenType.SHR:
            case TokenType.SHRU:
                return 11;
            case TokenType.LT:
            case TokenType.LE:
            case TokenType.GT:
            case TokenType.GE:
                return 10;
            case TokenType.EQ:
            case TokenType.NEQ:
                return 9;
            case TokenType.BAND:
                return 8;
            case TokenType.BXOR:
                return 7;
            case TokenType.BOR:
                return 6;
            case TokenType.AND:
                return 5;
            case TokenType.OR:
                return 4;
            case TokenType.COLON:
                return 3;
            case TokenType.QUESTION:
                return 2;
            default:
                return 0;
        }
    }

    private _toToken(operator: string): Token {
        switch (operator) {
            case TokenType.NEGATION:
            case TokenType.POSITIVE:
            case TokenType.QUESTION:
            case TokenType.COLON:
            case TokenType.BNOT:
            case TokenType.LT:
            case TokenType.LE:
            case TokenType.EQ:
            case TokenType.NEQ:
            case TokenType.GT:
            case TokenType.GE:
            case TokenType.ADD:
            case TokenType.SUB:
            case TokenType.MUL:
            case TokenType.DIV:
            case TokenType.DOT:
            case TokenType.MOD:
            case TokenType.SHL:
            case TokenType.SHR:
            case TokenType.SHRU:
            case TokenType.BAND:
            case TokenType.BOR:
            case TokenType.BXOR:
            case TokenType.NOT:
            case TokenType.AND:
            case TokenType.OR:
                return { type: operator };
            default:
                throw new Error(`unsupport operator: ${operator}`);
        }
    }

    private _isOperator(token: string) {
        return (
            token === TokenType.LPAREN ||
            token === TokenType.RPAREN ||
            token === TokenType.QUESTION ||
            token === TokenType.COLON ||
            token === TokenType.BNOT ||
            token === TokenType.LT ||
            token === TokenType.LE ||
            token === TokenType.EQ ||
            token === TokenType.NEQ ||
            token === TokenType.GT ||
            token === TokenType.GE ||
            token === TokenType.ADD ||
            token === TokenType.SUB ||
            token === TokenType.MUL ||
            token === TokenType.DIV ||
            token === TokenType.DOT ||
            token === TokenType.MOD ||
            token === TokenType.SHL ||
            token === TokenType.SHR ||
            token === TokenType.SHRU ||
            token === TokenType.BAND ||
            token === TokenType.BOR ||
            token === TokenType.BXOR ||
            token === TokenType.NOT ||
            token === TokenType.AND ||
            token === TokenType.OR
        );
    }

    private _convertToPostfix(infix: string[]) {
        const outputQueue: Token[] = [];
        const operatorStack: string[] = [];

        for (let i = 0; i < infix.length; i++) {
            let token = infix[i];
            if (token === "-" || token === "+") {
                const last = infix[i - 1];
                if (last === undefined || this._isOperator(last)) {
                    token = token === "-" ? TokenType.NEGATION : TokenType.POSITIVE;
                }
            }
            if (/^\d+|\d+\.\d+$/.test(token)) {
                outputQueue.push({
                    type: TokenType.NUMBER,
                    value: parseFloat(token),
                });
            } else if (/^\w+$/.test(token)) {
                if (token === "true") {
                    outputQueue.push({ type: TokenType.BOOLEAN, value: true });
                } else if (token === "false") {
                    outputQueue.push({ type: TokenType.BOOLEAN, value: false });
                } else {
                    outputQueue.push({ type: TokenType.STRING, value: token });
                }
            } else if (token === "(") {
                operatorStack.push(token);
            } else if (token === ")") {
                while (operatorStack.length && operatorStack[operatorStack.length - 1] !== "(") {
                    outputQueue.push(this._toToken(operatorStack.pop()!));
                }
                operatorStack.pop();
            } else {
                while (
                    operatorStack.length &&
                    this._precedence(token) <=
                        this._precedence(operatorStack[operatorStack.length - 1])
                ) {
                    outputQueue.push(this._toToken(operatorStack.pop()!));
                }
                operatorStack.push(token);
            }
        }

        while (operatorStack.length) {
            outputQueue.push(this._toToken(operatorStack.pop()!));
        }

        return outputQueue;
    }

    /**
     * Performs a dry run of the expression evaluation to check if it is syntactically valid.
     * Does not actually evaluate values, just verifies operator/operand counts and structure.
     * @returns true if expression is valid, false if invalid
     */
    dryRun(): boolean {
        const stack: Token[] = [];

        try {
            for (const token of this._postfix) {
                const type = token.type;
                if (
                    type === TokenType.NUMBER ||
                    type === TokenType.BOOLEAN ||
                    type === TokenType.STRING
                ) {
                    stack.push(token);
                } else if (type === TokenType.QUESTION) {
                    if (stack.length < 3) {
                        return false; // Not enough operands for ternary operator
                    }
                    stack.pop();
                    stack.pop();
                } else if (
                    type === TokenType.POSITIVE ||
                    type === TokenType.NEGATION ||
                    type === TokenType.NOT ||
                    type === TokenType.BNOT
                ) {
                    if (stack.length < 1) {
                        console.log(`Not enough operands for unary operator: ${type}`);
                        return false;
                    }
                } else {
                    if (stack.length < 2) {
                        console.log(`Not enough operands for binary operator: ${type}`);
                        return false;
                    }
                    const b = stack.pop()!; // b
                    const a = stack.pop()!; // a
                    stack.push(a);
                    if (type === TokenType.DOT) {
                        if (a.type !== TokenType.STRING || b.type !== TokenType.STRING) {
                            console.log(
                                `Invalid operands for dot operator: ${a.value} and ${b.value}`
                            );
                            return false;
                        }
                    } else if (type === TokenType.COLON) {
                        stack.push(b);
                    }
                }
            }
            if (stack.length !== 1) {
                console.log(
                    `Invalid number of operands remaining: ${stack.map((t) => t.value).join(", ")}`
                );
            }
            return stack.length === 1;
        } catch {
            return false;
        }
    }
}
