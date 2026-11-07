/**
 * Local ESLint plugin (`codify/*`) — wired from the root eslint.config.mjs.
 *   - codify/no-raw-template-text        docs/11 §11
 *   - codify/rewards-through-orchestrator docs/03 gamification-engine
 */
import noRawTemplateText from './rules/no-raw-template-text.mjs';
import rewardsThroughOrchestrator from './rules/rewards-through-orchestrator.mjs';

const plugin = {
  meta: { name: 'codify', version: '0.0.1' },
  rules: {
    'no-raw-template-text': noRawTemplateText,
    'rewards-through-orchestrator': rewardsThroughOrchestrator,
  },
};

export default plugin;
