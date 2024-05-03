module.exports = {
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    plugins: ["@typescript-eslint", "@stylistic/js"],
    parser: "@typescript-eslint/parser",
    rules: {
        "@typescript-eslint/no-namespace": "off",
        "@typescript-eslint/no-shadow": "error",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-floating-promises": "off",

        // https://eslint.style/rules/js/lines-between-class-members
        "@stylistic/js/lines-between-class-members": [
            "error",
            {
                enforce: [
                    { blankLine: "always", prev: "method", next: "method" },
                    { blankLine: "always", prev: "field", next: "method" },
                    { blankLine: "always", prev: "method", next: "field" },
                ],
            },
        ],
    },
    parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
    },
    root: true,
};
