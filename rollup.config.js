import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";

export default {
    input: "src/behavior3/index.ts",
    output: {
        file: "dist/bundle.js",
        format: "esm", // esm, cjs
        sourcemap: true,
    },
    plugins: [typescript(), commonjs()],
};
