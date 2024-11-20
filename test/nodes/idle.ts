import { Node, NodeDef, Process, Status, TreeEnv } from "../../src/behavior3";

export class Idle extends Process {
    override tick(node: Node, env: TreeEnv): Status {
        console.log("Do Idle");
        return "success";
    }

    override get descriptor(): NodeDef {
        return { name: "Idle", type: "Action", desc: "待机" };
    }
}
