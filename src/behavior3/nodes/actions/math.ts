import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import type { Tree } from "../../tree";

enum Op {
    // 基础运算
    abs = 0,
    ceil = 1,
    floor = 2,
    round = 3,
    sign = 4,
    // 三角函数
    sin = 5,
    cos = 6,
    tan = 7,
    atan2 = 8,
    // 幂和对数
    pow = 9,
    sqrt = 10,
    log = 11,
    // 最值运算
    min = 12,
    max = 13,
    // 随机数
    random = 14,
    randInt = 15,
    randFloat = 16,
    // 其他运算
    sum = 17,
    average = 18,
    product = 19,
}

@registerNode
export class MathNode extends Node {
    private _op: Op;

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);
        this._op = Op[cfg.args.op as keyof typeof Op];
        if (this._op === undefined) {
            throw new Error(`unknown op: ${cfg.args.op}`);
        }
    }

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly unknown[],
        output: unknown[],
    ): Status {
        const op = this._op;
        const args = this.args as { value1?: number; value2?: number };
        const inputValues = input.filter((value) => value !== undefined).map(Number);

        // 优先使用常量参数，如果没有则使用输入参数
        const values: number[] = [];
        if (args.value1 !== undefined) {
            values[0] = args.value1;
        } else if (inputValues.length > 0) {
            values[0] = inputValues[0];
        }

        if (args.value2 !== undefined) {
            values[1] = args.value2;
        } else if (inputValues.length > 1) {
            values[1] = inputValues[1];
        }

        // 对于需要更多参数的运算（min, max, sum等），添加剩余的输入参数
        if (inputValues.length > 2) {
            values.push(...inputValues.slice(2));
        }

        if (values.length === 0 && op !== Op.random && op !== Op.randInt && op !== Op.randFloat) {
            this.warn("at least one parameter is required");
            return "error";
        }

        let result: number;
        switch (op) {
            case Op.abs: {
                if (values.length !== 1) {
                    this.warn("abs operation requires exactly one parameter");
                    return "error";
                }
                result = Math.abs(values[0]);
                break;
            }
            case Op.ceil: {
                if (values.length !== 1) {
                    this.warn("ceil operation requires exactly one parameter");
                    return "error";
                }
                result = Math.ceil(values[0]);
                break;
            }
            case Op.floor: {
                if (values.length !== 1) {
                    this.warn("floor operation requires exactly one parameter");
                    return "error";
                }
                result = Math.floor(values[0]);
                break;
            }
            case Op.round: {
                if (values.length !== 1) {
                    this.warn("round operation requires exactly one parameter");
                    return "error";
                }
                result = Math.round(values[0]);
                break;
            }
            case Op.sin: {
                if (values.length !== 1) {
                    this.warn("sin operation requires exactly one parameter");
                    return "error";
                }
                result = Math.sin(values[0]);
                break;
            }
            case Op.cos: {
                if (values.length !== 1) {
                    this.warn("cos operation requires exactly one parameter");
                    return "error";
                }
                result = Math.cos(values[0]);
                break;
            }
            case Op.tan: {
                if (values.length !== 1) {
                    this.warn("tan operation requires exactly one parameter");
                    return "error";
                }
                result = Math.tan(values[0]);
                break;
            }
            case Op.pow: {
                if (values.length !== 2) {
                    this.warn("pow operation requires exactly two parameters");
                    return "error";
                }
                result = Math.pow(values[0], values[1]);
                break;
            }
            case Op.sqrt: {
                if (values.length !== 1) {
                    this.warn("sqrt operation requires exactly one parameter");
                    return "error";
                }
                result = Math.sqrt(values[0]);
                break;
            }
            case Op.log: {
                if (values.length !== 1) {
                    this.warn("log operation requires exactly one parameter");
                    return "error";
                }
                result = Math.log(values[0]);
                break;
            }
            case Op.min: {
                result = Math.min(...values);
                break;
            }
            case Op.max: {
                result = Math.max(...values);
                break;
            }
            case Op.sum: {
                result = values.reduce((a, b) => a + b, 0);
                break;
            }
            case Op.average: {
                result = values.reduce((a, b) => a + b, 0) / values.length;
                break;
            }
            case Op.product: {
                result = values.reduce((a, b) => a * b, 1);
                break;
            }
            case Op.sign: {
                if (values.length !== 1) {
                    this.warn("sign operation requires exactly one parameter");
                    return "error";
                }
                result = Math.sign(values[0]);
                break;
            }
            case Op.atan2: {
                if (values.length !== 2) {
                    this.warn("atan2 operation requires exactly two parameters");
                    return "error";
                }
                result = Math.atan2(values[0], values[1]);
                break;
            }
            case Op.random: {
                result = Math.random();
                break;
            }
            case Op.randInt: {
                if (values.length !== 2) {
                    this.warn("randInt operation requires two parameters (min and max)");
                    return "error";
                }
                const min = Math.ceil(values[0]);
                const max = Math.floor(values[1]);
                if (min > max) {
                    this.warn("minimum value cannot be greater than maximum value");
                    return "error";
                }
                result = Math.floor(Math.random() * (max - min + 1)) + min;
                break;
            }
            case Op.randFloat: {
                if (values.length !== 2) {
                    this.warn("randFloat operation requires two parameters (min and max)");
                    return "error";
                }
                if (values[0] > values[1]) {
                    this.warn("minimum value cannot be greater than maximum value");
                    return "error";
                }
                result = Math.random() * (values[1] - values[0]) + values[0];
                break;
            }
            default: {
                return "failure";
            }
        }

        if (isNaN(result)) {
            this.warn(`result is NaN: ${result}`);
            return "error";
        }

        output.push(result);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Math",
            type: "Action",
            group: ["Core"],
            desc: "数学运算，结果写入输出变量",
            doc: `
                + 按 \`运算类型\` 计算，结果写入 \`结果\`，返回 \`success\`
                + 操作数：第一、二个优先用参数1、参数2，没有配置时依次取输入变量，其余输入变量追加在后面
                + 一个操作数：绝对值、取整、四舍五入、符号、三角函数、平方根、自然对数
                + 两个操作数：反正切2（y, x）、幂运算（底数, 指数）、随机整数和随机浮点数（最小值, 最大值）
                + 任意个操作数：最小值、最大值、求和、平均值、乘积；随机数不需要操作数，返回 [0, 1) 的随机数
                + 操作数个数不对、最小值大于最大值、结果为 NaN 时，返回 \`error\`
            `,
            input: ["操作数..."],
            output: ["结果"],
            status: ["success", "failure"],
            args: [
                {
                    name: "op",
                    type: "string",
                    desc: "运算类型",
                    options: [
                        {
                            source: [
                                // 基础运算
                                { name: "绝对值", value: Op[Op.abs] },
                                { name: "向上取整", value: Op[Op.ceil] },
                                { name: "向下取整", value: Op[Op.floor] },
                                { name: "四舍五入", value: Op[Op.round] },
                                { name: "符号", value: Op[Op.sign] },
                                // 三角函数
                                { name: "正弦", value: Op[Op.sin] },
                                { name: "余弦", value: Op[Op.cos] },
                                { name: "正切", value: Op[Op.tan] },
                                { name: "反正切2", value: Op[Op.atan2] },
                                // 幂和对数
                                { name: "幂运算", value: Op[Op.pow] },
                                { name: "平方根", value: Op[Op.sqrt] },
                                { name: "自然对数", value: Op[Op.log] },
                                // 最值运算
                                { name: "最小值", value: Op[Op.min] },
                                { name: "最大值", value: Op[Op.max] },
                                // 随机数
                                { name: "随机数", value: Op[Op.random] },
                                { name: "随机整数", value: Op[Op.randInt] },
                                { name: "随机浮点数", value: Op[Op.randFloat] },
                                // 其他运算
                                { name: "求和", value: Op[Op.sum] },
                                { name: "平均值", value: Op[Op.average] },
                                { name: "乘积", value: Op[Op.product] },
                            ],
                        },
                    ],
                },
                {
                    name: "value1",
                    type: "float?",
                    desc: "参数1（优先于输入）",
                },
                {
                    name: "value2",
                    type: "float?",
                    desc: "参数2（优先于输入）",
                },
            ],
        };
    }
}
