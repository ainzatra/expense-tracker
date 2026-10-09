// Metro requires literal import paths. LangChain's optional universal loader
// chooses a package at runtime, although our agent receives ChatOpenAI directly.
// Keep the upstream agent intact and limit the loader to the installed adapter.
module.exports = ({ types: t }) => ({
  name: 'metro-langchain-provider',
  visitor: {
    CallExpression(path, state) {
      if (
        !state.filename
          ?.replaceAll('\\', '/')
          .endsWith('/langchain/dist/chat_models/universal.js') ||
        path.node.callee.type !== 'Import' ||
        t.isStringLiteral(path.node.arguments[0])
      )
        return;
      const source = path.node.arguments[0];
      path.replaceWith(
        t.conditionalExpression(
          t.binaryExpression(
            '===',
            source,
            t.stringLiteral('@langchain/openai'),
          ),
          t.callExpression(t.import(), [t.stringLiteral('@langchain/openai')]),
          t.callExpression(
            t.memberExpression(t.identifier('Promise'), t.identifier('reject')),
            [
              t.newExpression(t.identifier('Error'), [
                t.stringLiteral(
                  'Pass a configured ChatOpenAI instance to the mobile agent. Other providers use an OpenAI-compatible endpoint.',
                ),
              ]),
            ],
          ),
        ),
      );
    },
  },
});
