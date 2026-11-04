import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

type WaitState = {
    triggered: boolean;
    expired: number;
    /** Removes the listener of this node only, not the other listeners of the tree. */
    cancel: () => void;
};

@registerNode
export class WaitForEvent extends Node {
    declare args: {
        readonly event: string;
    };

    override onTick(tree: Tree<Context, unknown>): Status {
        const time = tree.context.time;
        const state = tree.getState<WaitState>(this);

        if (state === undefined) {
            const newState: WaitState = { triggered: false, expired: time + 5, cancel: () => {} };
            newState.cancel = tree.context.on(
                this.args.event,
                () => {
                    newState.triggered = true;
                    newState.cancel();
                },
                tree,
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
        tree.getState<WaitState>(this)?.cancel();
    }

    static override get descriptor(): NodeDef {
        return {
            name: "WaitForEvent",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "running"],
            desc: "等待事件触发后返回成功",
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件名",
                },
            ],
            doc: `
                + 开始执行时侦听 Context 上的 \`事件名\`（\`dispatch\` 时不带目标），事件触发前返回 \`running\`
                + 事件触发后，下一次执行返回 \`success\`
                + 被中止或打断时移除侦听
            `,
        };
    }
}
