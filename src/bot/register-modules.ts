import type { Dependencies } from '../types/dependencies.js';
import { registerProtectionModule } from '../modules/protection/index.js';
import { registerFilterModule } from '../modules/filters/index.js';
import { registerWelcomeModule } from '../modules/welcome/index.js';
import { registerRulesModule } from '../modules/rules/index.js';
import { registerModerationModule } from '../modules/moderation/index.js';
import { registerRolesModule } from '../modules/roles/index.js';
import { registerNightModeModule } from '../modules/nightmode/index.js';
import { registerScheduledMessagesModule } from '../modules/scheduled-messages/index.js';
import { registerAdminLogModule } from '../modules/admin-log/index.js';
import { registerInformationModule } from '../modules/information/index.js';
import { registerCustomCommandsModule } from '../modules/custom-commands/index.js';

export function registerModules(dependencies: Dependencies): void {
  registerProtectionModule(dependencies);
  registerFilterModule(dependencies);
  registerWelcomeModule(dependencies);
  registerRulesModule(dependencies);
  registerModerationModule(dependencies);
  registerRolesModule(dependencies);
  registerNightModeModule(dependencies);
  registerScheduledMessagesModule(dependencies);
  registerAdminLogModule(dependencies);
  registerInformationModule(dependencies);
  registerCustomCommandsModule(dependencies);
}
