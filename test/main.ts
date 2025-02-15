import assert from "assert";
import { Tree } from "../src/behavior3";
import { Role, RoleContext } from "./role";

import * as fs from "fs";

const context = new RoleContext();

fs.writeFileSync("example/node-config.b3-setting", context.exportNodeDefs());

context.avators.push({ x: 200, y: 0, hp: 100 });
context.avators.push({ x: 0, y: 0, hp: 100 });

const createTree = (owner: Role, treePath: string) => {
    context.loadTree(treePath);
    return new Tree<RoleContext, Role>(context, owner, treePath);
};

console.log("====================test hero=============================");
// -- test hero
const heroAi = createTree(context.avators[1], "./example/hero.json");
heroAi.tick();
heroAi.tick();
heroAi.tick();
heroAi.tick();
heroAi.tick();
heroAi.tick();

//后摇;
heroAi.tick();
heroAi.interrupt();
heroAi.tick();
context.time = 20;
heroAi.tick();

console.log("====================test monster=============================");
const monsterAi = createTree(context.avators[0], "./example/monster.json");
monsterAi.owner.hp = 100;
monsterAi.tick();

monsterAi.owner.hp = 20;
monsterAi.tick();
monsterAi.context.time = 40;
monsterAi.tick();
monsterAi.tick();

console.log("run end");

console.log("====================test api=============================");
const testTree = (
    name: string,
    onTick?: (i: number, runner: Tree<RoleContext, Role>) => boolean
) => {
    const tree = createTree({ hp: 100, x: 0, y: 0 }, `./example/${name}.json`);
    let i = 0;
    while (i < 100) {
        context.update(1);
        tree.tick();
        if (onTick) {
            if (!onTick(i, tree)) {
                break;
            }
        } else if (tree.status === "success") {
            break;
        }
        i++;
    }
    assert(tree.status === "success", `tree ${name} failed`);
    console.log("");
};
testTree("test-sequence");
testTree("test-parallel");
testTree("test-repeat-until-success");
testTree("test-repeat-until-failure");
testTree("test-timeout");
testTree("test-once");
testTree("test-listen", (i, tree) => {
    if (i === 0) {
        context.dispatch("hello", undefined, "world");
        context.dispatch("testOff");
        context.off("testOff", tree);
        return true;
    } else if (i === 1) {
        context.dispatch("hello", undefined, "world");
        context.dispatch("testOff");
        context.offAll(tree);
        return true;
    } else {
        context.dispatch("hello", undefined, "world");
        context.dispatch("testOff");
        return false;
    }
});
testTree("test-switch-case");
testTree("test-race");
console.log("====================test api end======================");
