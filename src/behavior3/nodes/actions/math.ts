import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import type { Tree } from "../../tree";

type Op =
    // 基础运算
    | "abs"
    | "ceil"
    | "floor"
    | "round"
    | "sign"
    // 三角函数
    | "sin"
    | "cos"
    | "tan"
    | "atan2"
    // 幂和对数
    | "pow"
    | "sqrt"
    | "log"
    // 最值运算
    | "min"
    | "max"
    // 随机数
    | "random" // 返回 [0,1) 之间的随机数
    | "randInt" // 返回指定范围内的随机整数 [min, max]
    | "randFloat" // 返回指定范围内的随机浮点数 [min, max)
    // 其他运算
    | "sum"
    | "average"
    | "product";

export class MathNode extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const args = this.args as { op: Op; value1?: number; value2?: number };
        const inputValues = this.input.filter((value) => value !== undefined).map(Number);

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

        if (
            values.length === 0 &&
            args.op !== "random" &&
            args.op !== "randInt" &&
            args.op !== "randFloat"
        ) {
            this.error("至少需要一个输入值");
            return "failure";
        }

        try {
            let result: number;
            switch (args.op) {
                case "abs": {
                    if (values.length !== 1) {
                        this.error("abs运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.abs(values[0]);
                    break;
                }
                case "ceil": {
                    if (values.length !== 1) {
                        this.error("ceil运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.ceil(values[0]);
                    break;
                }
                case "floor": {
                    if (values.length !== 1) {
                        this.error("floor运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.floor(values[0]);
                    break;
                }
                case "round": {
                    if (values.length !== 1) {
                        this.error("round运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.round(values[0]);
                    break;
                }
                case "sin": {
                    if (values.length !== 1) {
                        this.error("sin运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.sin(values[0]);
                    break;
                }
                case "cos": {
                    if (values.length !== 1) {
                        this.error("cos运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.cos(values[0]);
                    break;
                }
                case "tan": {
                    if (values.length !== 1) {
                        this.error("tan运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.tan(values[0]);
                    break;
                }
                case "pow": {
                    if (values.length !== 2) {
                        this.error("pow运算需要两个参数");
                        return "failure";
                    }
                    result = Math.pow(values[0], values[1]);
                    break;
                }
                case "sqrt": {
                    if (values.length !== 1) {
                        this.error("sqrt运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.sqrt(values[0]);
                    break;
                }
                case "log": {
                    if (values.length !== 1) {
                        this.error("log运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.log(values[0]);
                    break;
                }
                case "min": {
                    result = Math.min(...values);
                    break;
                }
                case "max": {
                    result = Math.max(...values);
                    break;
                }
                case "sum": {
                    result = values.reduce((a, b) => a + b, 0);
                    break;
                }
                case "average": {
                    result = values.reduce((a, b) => a + b, 0) / values.length;
                    break;
                }
                case "product": {
                    result = values.reduce((a, b) => a * b, 1);
                    break;
                }
                case "sign": {
                    if (values.length !== 1) {
                        this.error("sign运算只需要一个参数");
                        return "failure";
                    }
                    result = Math.sign(values[0]);
                    break;
                }
                case "atan2": {
                    if (values.length !== 2) {
                        this.error("atan2运算需要两个参数");
                        return "failure";
                    }
                    result = Math.atan2(values[0], values[1]);
                    break;
                }
                case "random": {
                    result = Math.random();
                    break;
                }
                case "randInt": {
                    if (values.length !== 2) {
                        this.error("randInt运算需要两个参数（最小值和最大值）");
                        return "failure";
                    }
                    const min = Math.ceil(values[0]);
                    const max = Math.floor(values[1]);
                    if (min > max) {
                        this.error("最小值不能大于最大值");
                        return "failure";
                    }
                    result = Math.floor(Math.random() * (max - min + 1)) + min;
                    break;
                }
                case "randFloat": {
                    if (values.length !== 2) {
                        this.error("randFloat运算需要两个参数（最小值和最大值）");
                        return "failure";
                    }
                    if (values[0] > values[1]) {
                        this.error("最小值不能大于最大值");
                        return "failure";
                    }
                    result = Math.random() * (values[1] - values[0]) + values[0];
                    break;
                }
                default: {
                    this.error(`未知的运算类型: ${args.op}`);
                    return "failure";
                }
            }

            this.output.push(result);
            return "success";
        } catch (error) {
            this.error(`计算错误: ${error}`);
            return "failure";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Math",
            type: "Action",
            desc: "执行数学运算",
            input: ["参数..."],
            output: ["结果"],
            status: ["success", "failure"],
            args: [
                {
                    name: "op",
                    type: "enum",
                    desc: "数学运算类型",
                    options: [
                        // 基础运算
                        { name: "绝对值", value: "abs" },
                        { name: "向上取整", value: "ceil" },
                        { name: "向下取整", value: "floor" },
                        { name: "四舍五入", value: "round" },
                        { name: "符号", value: "sign" },
                        // 三角函数
                        { name: "正弦", value: "sin" },
                        { name: "余弦", value: "cos" },
                        { name: "正切", value: "tan" },
                        { name: "反正切2", value: "atan2" },
                        // 幂和对数
                        { name: "幂运算", value: "pow" },
                        { name: "平方根", value: "sqrt" },
                        { name: "自然对数", value: "log" },
                        // 最值运算
                        { name: "最小值", value: "min" },
                        { name: "最大值", value: "max" },
                        // 随机数
                        { name: "随机数", value: "random" },
                        { name: "随机整数", value: "randInt" },
                        { name: "随机浮点数", value: "randFloat" },
                        // 其他运算
                        { name: "求和", value: "sum" },
                        { name: "平均值", value: "average" },
                        { name: "乘积", value: "product" },
                    ],
                },
                {
                    name: "value1",
                    type: "float?",
                    desc: "参数1（优先使用）",
                },
                {
                    name: "value2",
                    type: "float?",
                    desc: "参数2（优先使用）",
                },
            ],
        };
    }
}
