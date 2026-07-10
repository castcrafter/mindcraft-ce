import globals from 'globals';
import pluginJs from '@eslint/js';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        ignores: [
            'node_modules/**',
            'bots/**',
            'src/mindcraft/public/js/handlebars-v4.7.8.js'
        ]
    },
    pluginJs.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                Compartment: 'readonly'
            },
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': 'off',
            'no-unreachable': 'off',
            'no-prototype-builtins': 'off',
            'no-empty': 'off',
            'no-extra-boolean-cast': 'off',
            'semi': 'off',
            'curly': 'off',
            'require-await': 'off'
        }
    },
    {
        files: ['src/mindcraft/public/js/main.js'],
        languageOptions: {
            globals: { io: 'readonly' }
        },
        rules: {
            'no-case-declarations': 'off'
        }
    }
];
