import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";

const tsPlugin = () =>
    typescript({
        declaration: false,
        declarationMap: false,
        moduleResolution: "bundler",
        module: "ESNext",
    });

export default [
    {
        input: "src/behavior3/index.ts",
        output: {
            file: "dist/index.mjs",
            format: "esm",
            sourcemap: true,
        },
        plugins: [tsPlugin(), commonjs()],
    },
    {
        input: "src/behavior3/index.ts",
        output: {
            file: "dist/index.cjs",
            format: "cjs",
            sourcemap: true,
        },
        plugins: [tsPlugin(), commonjs()],
    },
];
