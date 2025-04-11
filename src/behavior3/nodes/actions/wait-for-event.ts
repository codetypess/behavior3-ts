import { Blackboard } from "../../blackboard";
import type { Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { Tree, TreeEvent } from "../../tree";

export class WaitForEvent extends Node {
    declare args: {
        readonly event: string;
    };

    private _triggerKey!: string;
    private _expiredKey!: string;

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        this._triggerKey = Blackboard.makeTempVar(this, "trigger");
        this._expiredKey = Blackboard.makeTempVar(this, "expired");
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const triggerKey = this._triggerKey;
        const triggered = tree.blackboard.get(triggerKey);
        const expiredKey = this._expiredKey;
        const expired = tree.blackboard.get<number>(expiredKey) ?? tree.context.time;
        if (triggered === true) {
            tree.blackboard.set(triggerKey, undefined);
            tree.blackboard.set(expiredKey, undefined);
            return "success";
        } else if (triggered === undefined) {
            tree.blackboard.set(triggerKey, false);
            tree.blackboard.set(expiredKey, tree.context.time + 5);
            tree.context.on(
                this.args.event,
                () => {
                    tree.blackboard.set(triggerKey, true);
                    tree.context.off(this.args.event, tree);
                    tree.context.off(TreeEvent.INTERRUPTED, tree);
                },
                tree
            );
            tree.context.on(
                TreeEvent.INTERRUPTED,
                () => {
                    tree.blackboard.set(triggerKey, undefined);
                    tree.blackboard.set(expiredKey, undefined);
                    tree.context.off(this.args.event, tree);
                    tree.context.off(TreeEvent.INTERRUPTED, tree);
                },
                tree
            );
        } else if (tree.context.time >= expired) {
            tree.blackboard.set(expiredKey, tree.context.time + 5);
            this.debug(`wait for event: ${this.args.event}`);
        }

        return "running";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "WaitForEvent",
            type: "Action",
            children: 0,
            status: ["success", "running"],
            desc: "等待事件触发",
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件名称",
                },
            ],
        };
    }
}
