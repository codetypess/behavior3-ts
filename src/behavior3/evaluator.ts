import { ObjectType } from "./tree-env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Evaluator = (envars: any) => unknown;

const enum TokenType {
    NUMBER,
    STRING,
    DOT,
    GT,
    GE,
    EQ,
    LT,
    LE,
    ADD,
    SUB,
    MUL,
    DIV,
}
type Token = {
    type: TokenType;
    value?: string | number;
};

export class ExpressionEvaluator {
    private _postfix: Token[];
    private _args: ObjectType | null = null;

    constructor(expression: string) {
        expression = expression.replace(/\s/g, "");
        const tokens = expression.match(/\d+\.\d+|\w+|\d+|>=|<=|==|>|<|[-+*/().]/g);
        if (!tokens) {
            throw new Error("Invalid expression");
        }
        this._postfix = this._convertToPostfix(tokens);
    }

    evaluate(args: ObjectType): unknown {
        const stack: (string | number)[] = [];

        this._args = args;
        for (const token of this._postfix) {
            const type = token.type;
            if (type === TokenType.NUMBER) {
                stack.push(token.value as number);
            } else if (type === TokenType.STRING) {
                stack.push(token.value as string);
            } else {
                const b = stack.pop()!;
                const a = stack.pop()!;
                switch (type) {
                    case TokenType.DOT: {
                        const obj = this._toObject(a);
                        stack.push(this._toNumber(obj[b]));
                        break;
                    }
                    case TokenType.GT:
                        return this._toNumber(a) > this._toNumber(b);
                    case TokenType.GE:
                        return this._toNumber(a) >= this._toNumber(b);
                    case TokenType.EQ:
                        return this._toNumber(a) === this._toNumber(b);
                    case TokenType.LT:
                        return this._toNumber(a) < this._toNumber(b);
                    case TokenType.LE:
                        return this._toNumber(a) <= this._toNumber(b);
                    case TokenType.ADD:
                        stack.push(this._toNumber(a) + this._toNumber(b));
                        break;
                    case TokenType.SUB:
                        stack.push(this._toNumber(a) - this._toNumber(b));
                        break;
                    case TokenType.MUL:
                        stack.push(this._toNumber(a) * this._toNumber(b));
                        break;
                    case TokenType.DIV:
                        stack.push(this._toNumber(a) / this._toNumber(b));
                        break;
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

    private _toNumber(token: unknown) {
        if (typeof token === "number") {
            return token;
        } else if (typeof token === "string") {
            const value = this._args?.[token];
            if (typeof value === "number") {
                return value;
            } else if (value === undefined) {
                throw new Error(`value indexed by '${token}' is not found`);
            } else {
                throw new Error(`value indexed by '${token}' is not a number'`);
            }
        } else {
            throw new Error(`token '${token}' is not a number`);
        }
    }

    private _precedence(operator: string): number {
        switch (operator) {
            case "<":
            case "<=":
            case "==":
            case ">":
            case ">=":
                return 1;
            case "+":
            case "-":
                return 2;
            case "*":
            case "/":
                return 3;
            case ".":
                return 4;
            default:
                return 0;
        }
    }

    private _toToken(operator: string): Token {
        switch (operator) {
            case "<":
                return { type: TokenType.LT };
            case "<=":
                return { type: TokenType.LE };
            case "==":
                return { type: TokenType.EQ };
            case ">":
                return { type: TokenType.GT };
            case ">=":
                return { type: TokenType.GE };
            case "+":
                return { type: TokenType.ADD };
            case "-":
                return { type: TokenType.SUB };
            case "*":
                return { type: TokenType.MUL };
            case "/":
                return { type: TokenType.DIV };
            case ".":
                return { type: TokenType.DOT };
            default:
                throw new Error(`unsupport operator: ${operator}`);
        }
    }

    private _convertToPostfix(infix: string[]) {
        const outputQueue: Token[] = [];
        const operatorStack: string[] = [];

        infix.forEach((token) => {
            if (/^\d+$/.test(token)) {
                outputQueue.push({
                    type: TokenType.NUMBER,
                    value: parseFloat(token),
                });
            } else if (/^\w+$/.test(token)) {
                outputQueue.push({ type: TokenType.STRING, value: token });
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
        });

        while (operatorStack.length) {
            outputQueue.push(this._toToken(operatorStack.pop()!));
        }

        return outputQueue;
    }
}
