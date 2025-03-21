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
}

type Token = {
    type: TokenType;
    value?: string | number | boolean | null;
};

export class ExpressionEvaluator {
    private _postfix: Token[];
    private _args: ObjectType | null = null;

    constructor(expression: string) {
        expression = expression.replace(/\s/g, "");
        const tokens = expression.match(
            /\d+\.\d+|\w+|\d+|!|<<|>>>|>>|>=|<=|==|!=|>|<|&&|&|\|\||\||\^|\?|:|\.|[-+*%/()]/g
        );
        if (!tokens) {
            throw new Error("Invalid expression");
        }
        this._postfix = this._convertToPostfix(tokens);
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
            case TokenType.QUESTION: // 三元运算符优先级最低
            case TokenType.COLON:
                return 3;
            case TokenType.OR:
                return 4;
            case TokenType.AND:
                return 5;
            case TokenType.BOR:
                return 6;
            case TokenType.BXOR:
                return 7;
            case TokenType.BAND:
                return 8;
            case TokenType.EQ:
            case TokenType.NEQ:
                return 9;
            case TokenType.LT:
            case TokenType.LE:
            case TokenType.GT:
            case TokenType.GE:
                return 10;
            case TokenType.SHL:
            case TokenType.SHR:
            case TokenType.SHRU:
                return 11;
            case TokenType.ADD:
            case TokenType.SUB:
                return 12;
            case TokenType.MOD:
            case TokenType.MUL:
            case TokenType.DIV:
                return 13;
            case TokenType.NEGATION:
            case TokenType.POSITIVE:
            case TokenType.NOT:
                return 15;
            case TokenType.DOT:
                return 18;
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
            token === TokenType.QUESTION ||
            token === TokenType.COLON ||
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
}
