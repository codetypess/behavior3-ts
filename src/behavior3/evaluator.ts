// deno-lint-ignore-file no-explicit-any
import type { ObjectType } from "./context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Evaluator = (envars: any) => unknown;

// prettier-ignore
enum TokenType {
    NUMBER = 0,          // number
    STRING = 1,          // string
    BOOLEAN = 2,         // boolean
    NEGATION = 3,        // -N
    POSITIVE = 4,        // +N
    DOT = 5,             // .
    NOT = 6,             // !
    BNOT = 7,            // ~
    GT = 8,              // >
    GE = 9,              // >=
    EQ = 10,             // ==
    NEQ = 11,            // !=
    LT = 12,             // <
    LE = 13,             // <=
    ADD = 14,            // +
    SUB = 15,            // -
    MUL = 16,            // *
    DIV = 17,            // /
    MOD = 18,            // %
    QUESTION = 19,       // ?
    COLON = 20,          // :
    AND = 21,            // &&
    OR = 22,             // ||
    BAND = 23,           // &
    BOR = 24,            // |
    BXOR = 25,           // ^
    SHL = 26,            // <<
    SHR = 27,            // >>
    SHRU = 28,           // >>>
    SQUARE_BRACKET = 29, // []
    PARENTHESIS = 30,    // ()
}

type Token = {
    type: TokenType;
    precedence: number;
    value?: string | number | boolean | null;
};

const OP_REGEX = /^(<<|>>>|>>|>=|<=|==|!=|>|<|&&|&|\|\||[-+*%!?/:.|^()[\]])/;
const NUMBER_REGEX = /^(\d+\.\d+|\d+)/;
const WORD_REGEX = /^(\w+)/;

export class ExpressionEvaluator {
    private _postfix: Token[];
    private _args: ObjectType | null = null;
    private _expr: string;

    constructor(expression: string) {
        this._expr = expression;
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
            } else if (/^[-+*%/()<>=?&|:^.![\]]/.test(char)) {
                token = expr.match(OP_REGEX);
            }
            if (!token) {
                throw new Error(`invalid expression: '${expr}' in '${this._expr}'`);
            }
            tokens.push(token[1]);
            expr = expr.slice(token[1].length).replace(/^\s+/, "");
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
                    case TokenType.SQUARE_BRACKET: {
                        const obj = this._toObject(a);
                        const index = this._toValue(b);
                        stack.push(this._toObject(obj[index]));
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
                        throw new Error(`unsupport operator: ${token.value}`);
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
            return token as ObjectType;
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

    private _makeToken(symbol: string, last: string | undefined): Token {
        if (symbol === "-" || symbol === "+") {
            if (last === undefined || /^[-+*%<>=!&~^?:(|[]+$/.test(last)) {
                return {
                    type: symbol === "-" ? TokenType.NEGATION : TokenType.POSITIVE,
                    precedence: 15,
                    value: `${symbol}N`,
                };
            }
        }
        if (NUMBER_REGEX.test(symbol)) {
            return { type: TokenType.NUMBER, precedence: 0, value: parseFloat(symbol) };
        }
        if (symbol === "true" || symbol === "false") {
            return { type: TokenType.BOOLEAN, precedence: 0, value: symbol === "true" };
        }
        if (WORD_REGEX.test(symbol)) {
            return { type: TokenType.STRING, precedence: 0, value: symbol };
        }
        if (symbol === ".") {
            return { type: TokenType.DOT, precedence: 18, value: symbol };
        }
        if (symbol === "(" || symbol === ")") {
            // parenthesis is not a operator
            return { type: TokenType.PARENTHESIS, precedence: 0, value: symbol };
        }
        if (symbol === "[" || symbol === "]") {
            return { type: TokenType.SQUARE_BRACKET, precedence: 18, value: symbol };
        }
        if (symbol === "!") {
            return { type: TokenType.NOT, precedence: 15, value: symbol };
        }
        if (symbol === "~") {
            return { type: TokenType.BNOT, precedence: 15, value: symbol };
        }
        if (symbol === "%") {
            return { type: TokenType.MOD, precedence: 13, value: symbol };
        }
        if (symbol === "*") {
            return { type: TokenType.MUL, precedence: 13, value: symbol };
        }
        if (symbol === "/") {
            return { type: TokenType.DIV, precedence: 13, value: symbol };
        }
        if (symbol === "+") {
            return { type: TokenType.ADD, precedence: 12, value: symbol };
        }
        if (symbol === "-") {
            return { type: TokenType.SUB, precedence: 12, value: symbol };
        }
        if (symbol === "<<") {
            return { type: TokenType.SHL, precedence: 11, value: symbol };
        }
        if (symbol === ">>") {
            return { type: TokenType.SHR, precedence: 11, value: symbol };
        }
        if (symbol === ">>>") {
            return { type: TokenType.SHRU, precedence: 11, value: symbol };
        }
        if (symbol === ">") {
            return { type: TokenType.GT, precedence: 10, value: symbol };
        }
        if (symbol === ">=") {
            return { type: TokenType.GE, precedence: 10, value: symbol };
        }
        if (symbol === "<") {
            return { type: TokenType.LT, precedence: 10, value: symbol };
        }
        if (symbol === "<=") {
            return { type: TokenType.LE, precedence: 10, value: symbol };
        }
        if (symbol === "==") {
            return { type: TokenType.EQ, precedence: 9, value: symbol };
        }
        if (symbol === "!=") {
            return { type: TokenType.NEQ, precedence: 9, value: symbol };
        }
        if (symbol === "&") {
            return { type: TokenType.BAND, precedence: 8, value: symbol };
        }
        if (symbol === "&") {
            return { type: TokenType.BXOR, precedence: 7, value: symbol };
        }
        if (symbol === "|") {
            return { type: TokenType.BOR, precedence: 6, value: symbol };
        }
        if (symbol === "&&") {
            return { type: TokenType.AND, precedence: 5, value: symbol };
        }
        if (symbol === "||") {
            return { type: TokenType.OR, precedence: 4, value: symbol };
        }
        if (symbol === ":") {
            return { type: TokenType.COLON, precedence: 2, value: symbol };
        }
        if (symbol === "?") {
            return { type: TokenType.QUESTION, precedence: 2 - 0.1, value: symbol };
        }
        throw new Error(`unsupport token: ${symbol}`);
    }

    private _convertToPostfix(infix: string[]) {
        const output: Token[] = [];
        const operators: Token[] = [];

        for (let i = 0; i < infix.length; i++) {
            const token = this._makeToken(infix[i], infix[i - 1]);
            if (
                token.type === TokenType.NUMBER ||
                token.type === TokenType.BOOLEAN ||
                token.type === TokenType.STRING
            ) {
                output.push(token);
            } else if (token.value === "(" || token.value === "[") {
                operators.push(token);
            } else if (token.value === ")" || token.value === "]") {
                while (
                    operators.length &&
                    operators[operators.length - 1].value !== "(" &&
                    operators[operators.length - 1].value !== "["
                ) {
                    output.push(operators.pop()!);
                }

                const last = operators[operators.length - 1];
                if (token.value === ")" && last.value !== "(") {
                    throw new Error("unmatched parentheses: '('");
                } else if (token.value === "]" && last.value !== "[") {
                    throw new Error("unmatched parentheses: '['");
                }
                if (token.value === "]") {
                    output.push(operators.pop()!);
                } else {
                    operators.pop();
                }
            } else {
                while (
                    operators.length &&
                    token.precedence <= operators[operators.length - 1].precedence
                ) {
                    output.push(operators.pop()!);
                }
                operators.push(token);
            }
        }

        while (operators.length) {
            output.push(operators.pop()!);
        }

        return output;
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
                        console.error(`not enough operands for ternary operator: ${token.value}`);
                        return false;
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
                        console.error(`not enough operands for unary operator: ${token.value}`);
                        return false;
                    }
                } else {
                    if (stack.length < 2) {
                        console.error(`not enough operands for binary operator: ${token.value}`);
                        return false;
                    }
                    const b = stack.pop()!; // b
                    const a = stack.pop()!; // a
                    stack.push(a);
                    if (type === TokenType.DOT) {
                        if (a.type !== TokenType.STRING || b.type !== TokenType.STRING) {
                            console.error(
                                `invalid operands for dot operator: ${a.value} and ${b.value}`
                            );
                            return false;
                        }
                    } else if (type === TokenType.COLON) {
                        stack.push(b);
                    }
                }
            }
            if (stack.length !== 1) {
                console.error(
                    `invalid number of operands remaining: ${stack.map((t) => t.value).join(", ")}`
                );
            }
            return stack.length === 1;
        } catch {
            return false;
        }
    }
}
