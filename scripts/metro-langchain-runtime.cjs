// LangChain HITL relies on Node's ambient AsyncLocalStorage. Metro uses the
// published web runtime, so pass the middleware's existing task configuration
// explicitly to the upstream interrupt implementation. The agent, checkpoint
// and decision handling remain LangChain/LangGraph's provided implementations.
module.exports = ({ types: t }) => ({
  name: 'metro-langchain-runtime',
  visitor: {
    VariableDeclarator(path, state) {
      if (
        state.filename
          ?.replaceAll('\\', '/')
          .endsWith('/@langchain/langgraph/dist/interrupt.js') &&
        t.isIdentifier(path.node.id, { name: 'config' }) &&
        t.isCallExpression(path.node.init)
      ) {
        path.node.init = t.logicalExpression(
          '??',
          t.optionalMemberExpression(
            t.identifier('options'),
            t.identifier('config'),
            false,
            true,
          ),
          path.node.init,
        );
      }
    },
    CallExpression(path, state) {
      if (
        state.filename
          ?.replaceAll('\\', '/')
          .endsWith('/langchain/dist/agents/middleware/hitl.js') &&
        t.isIdentifier(path.node.callee, { name: 'interrupt' }) &&
        path.node.arguments.length === 1
      ) {
        path.node.arguments.push(
          t.objectExpression([
            t.objectProperty(
              t.identifier('config'),
              t.objectExpression([
                t.objectProperty(
                  t.identifier('configurable'),
                  t.memberExpression(
                    t.identifier('runtime'),
                    t.identifier('configurable'),
                  ),
                ),
              ]),
            ),
          ]),
        );
      }
    },
  },
});
