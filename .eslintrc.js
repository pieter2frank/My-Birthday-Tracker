module.exports = {
  root: true,
  extends: ['@react-native', 'eslint:recommended', 'plugin:react-hooks/recommended', 'prettier'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'react-hooks/exhaustive-deps': 'warn'
  }
};
