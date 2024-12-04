import { Node, NodeDef, Process, Status, TreeEnv } from "../../src/behavior3";

export class Idle extends Process {
    constructor() {
        super({
            name: "Idle",
            type: "Action",
            desc: "待机",
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        console.log("Do Idle");
        return "success";
    }
}
