import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Random extends Node {
    declare args: {
        readonly min?: number;
        readonly max?: number;
        readonly floor?: boolean;
    };

    override onTick(tree: Tree<Context, unknown>): Status {
        const args = this.args;
        const MAX_INT = Number.MAX_SAFE_INTEGER;
        const min = this._checkOneof(0, args.min, MAX_INT);
        const max = this._checkOneof(1, args.max, MAX_INT);
        let value = min + Math.random() * (max - min);
        if (args.floor) {
            value = Math.floor(value);
        }
        this.output.push(value);
        return "success";
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Random",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "返回一个随机数",
            input: ["最小值?", "最大值?"],
            args: [
                {
                    name: "min",
                    type: "float?",
                    desc: "最小值",
                    oneof: "最小值",
                },
                {
                    name: "max",
                    type: "float?",
                    desc: "最大值",
                    oneof: "最大值",
                },
                {
                    name: "floor",
                    type: "bool?",
                    desc: "是否向下取整",
                },
            ],
            output: ["随机数"],
        };
    }
}
