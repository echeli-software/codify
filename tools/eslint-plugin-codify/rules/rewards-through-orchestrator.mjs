/**
 * codify/rewards-through-orchestrator
 *
 * docs/03 gamification-engine "Done when: All reward events go through
 * `RewardOrchestrator` (lint rule enforces)". Outside
 * `libs/gamification-engine`, calling a mutating method of the state
 * services is an error — reading their signals stays allowed:
 *
 *   inject(XpService).displayed()          ✓ read
 *   this.coins.actual()                    ✓ read
 *   this.xp.setActual(10)                  ✗ use orchestrator.grant/reconcile
 *   inject(StreakService).set({...})       ✗
 *
 * Detection is syntactic (no type info needed): it tracks identifiers and
 * class members bound to `inject(XpService|CoinService|StreakService)`
 * (also `TestBed.inject(...)`) or declared with those types (constructor
 * parameter properties, typed fields / variables), then flags mutator
 * calls on them, including direct `inject(XpService).snap()` chains.
 */

const DEFAULT_SERVICES = {
  XpService: ['setActual', 'snap', 'tweenTo'],
  CoinService: ['setActual', 'snap', 'tweenTo'],
  StreakService: ['set'],
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Reward state may only be mutated by RewardOrchestrator (docs/03, docs/07 §11).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          services: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      mutation:
        '`{{service}}.{{method}}()` mutates reward state — go through `RewardOrchestrator.grant()` / `reconcile()` instead.',
    },
  },

  create(context) {
    const services = context.options[0]?.services ?? DEFAULT_SERVICES;
    /** binding name → service name (identifiers and `this.x` members share a namespace). */
    const bound = new Map();

    const serviceFromTypeAnnotation = (typeAnn) => {
      const t = typeAnn?.typeAnnotation;
      if (t?.type === 'TSTypeReference' && t.typeName?.type === 'Identifier') {
        return services[t.typeName.name] ? t.typeName.name : null;
      }
      return null;
    };

    /** `inject(XpService)` / `TestBed.inject(XpService)` → 'XpService'. */
    const serviceFromInject = (node) => {
      if (node?.type !== 'CallExpression') return null;
      const callee = node.callee;
      const isInject =
        (callee.type === 'Identifier' && callee.name === 'inject') ||
        (callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'inject');
      if (!isInject) return null;
      const arg = node.arguments[0];
      return arg?.type === 'Identifier' && services[arg.name] ? arg.name : null;
    };

    const keyOf = (node) => {
      if (!node) return null;
      if (node.type === 'Identifier') return node.name;
      if (node.type === 'PrivateIdentifier') return `#${node.name}`;
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'ThisExpression'
      ) {
        return keyOf(node.property);
      }
      return null;
    };

    const remember = (keyNode, service) => {
      const key = keyOf(keyNode);
      if (key && service) bound.set(key, service);
    };

    const pending = [];

    return {
      VariableDeclarator(node) {
        remember(
          node.id,
          serviceFromInject(node.init) ??
            serviceFromTypeAnnotation(node.id.typeAnnotation),
        );
      },
      PropertyDefinition(node) {
        remember(
          node.key,
          serviceFromInject(node.value) ??
            serviceFromTypeAnnotation(node.typeAnnotation),
        );
      },
      TSParameterProperty(node) {
        const p = node.parameter;
        remember(
          p.type === 'AssignmentPattern' ? p.left : p,
          serviceFromTypeAnnotation(
            (p.type === 'AssignmentPattern' ? p.left : p).typeAnnotation,
          ),
        );
      },
      AssignmentExpression(node) {
        remember(node.left, serviceFromInject(node.right));
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier') return;
        // Collect now, resolve at Program:exit so declaration order (fields
        // declared after methods) doesn't matter.
        pending.push({
          node,
          object: callee.object,
          method: callee.property.name,
        });
      },
      'Program:exit'() {
        for (const { node, object, method } of pending) {
          const service = serviceFromInject(object) ?? bound.get(keyOf(object));
          if (!service) continue;
          if (!services[service].includes(method)) continue;
          context.report({
            node,
            messageId: 'mutation',
            data: { service, method },
          });
        }
      },
    };
  },
};
