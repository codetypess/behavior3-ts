import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

type WaitState = { triggered: boolean; expired: number };

@registerNode
export class WaitForEvent extends Node {
    declare args: {
        readonly event: string;
    };

    override onTick(tree: Tree<Context, unknown>): Status {
        const time = tree.context.time;
        const state = tree.getState<WaitState>(this);

        if (state === undefined) {
            const newState: WaitState = { triggered: false, expired: time + 5 };
            const event = this.args.event;
            tree.context.on(
                event,
                () => {
                    newState.triggered = true;
                    tree.context.off(event, tree);
                },
                tree
            );
            tree.setState(this, newState);
        } else if (state.triggered) {
            return "success";
        } else if (time >= state.expired) {
            state.expired = time + 5;
            this.debug(`wait for event: ${this.args.event}`);
        }

        return "running";
    }

    override onAbort(tree: Tree<Context, unknown>): void {
        const state = tree.getState<WaitState>(this);
        if (state && !state.triggered) {
            tree.context.off(this.args.event, tree);
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "WaitForEvent",
            type: "Action",
            group: ["Core"],
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
