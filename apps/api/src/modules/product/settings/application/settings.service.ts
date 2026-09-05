import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@mohalla/localization';
import { DatabaseService } from '../../../../database/database.service.js';
import { StructuredLogger } from '../../../../common/logging/structured.logger.js';
import { PasswordService } from '../../../platform/identity/application/password.service.js';
import { NotificationService } from '../../../platform/notifications/application/notification.service.js';
import { BlockService } from '../../safety/application/block.service.js';
import { DeletionService, type DeleteResult } from './deletion.service.js';

export interface SettingsScreen {
  language: Locale | null;
  notifications: Record<string, boolean>;
  blockedCount: number;
}

/**
 * The settings surface (SET-FR-001…010).
 *
 * MOST OF SETTINGS IS OTHER MODULES' WORK, and that is the correct shape rather
 * than an accident. The requirements say so themselves — SET-FR-002 "see
 * AUTH-FR-007", SET-FR-003 "see SAFETY-FR-007", SET-FR-006 "see AUTH-FR-006",
 * SET-FR-007 "see NOTIF-FR-007". A settings screen is a place in the interface,
 * not a place in the domain, and re-implementing password change or block
 * management here would be a second implementation of a rule that already has
 * one.
 *
 * SO THIS SERVICE OWNS EXACTLY TWO THINGS: the stored language (SET-FR-001) and
 * the composition of the screen. Deletion has its own service, because it is
 * the one irreversible act in the product and deserves not to share a file with
 * a language toggle.
 *
 * SET-FR-008/009/010 — legal documents, support contact and version — have NO
 * server component. The documents are static URLs the client opens (their
 * content is blocked on OD-015), support is an email address in V1, and the
 * version is compiled into the app. An endpoint for any of them would be a
 * server round trip to learn something the client already has.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationService,
    private readonly blocks: BlockService,
    private readonly deletion: DeletionService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * SET-FR-001 — the language, stored on the ACCOUNT.
   *
   * "GIVEN Urdu is selected on one device, WHEN the user logs in on another
   * device, THEN Urdu is applied there too." That is only true if it lives with
   * the account rather than the handset, which is also what lets a push arrive
   * in the right language when the user is not the one making the request.
   */
  async setLanguage(userId: string, language: Locale): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query('UPDATE users SET language = $2 WHERE id = $1', [userId, language]);
    });
    // The language itself, not the user. Which of two languages somebody reads
    // is a small fact about them, and the row already records it.
    this.logger.log(JSON.stringify({ event: 'language_set', language }), 'settings');
  }

  async screenFor(userId: string): Promise<SettingsScreen> {
    // THE LANGUAGE IS READ HERE RATHER THAN THROUGH IDENTITY, because this
    // module writes it (SET-FR-001) and a module that owns a column should not
    // borrow another module's repository to read it back.
    const [language, notifications, blocked] = await Promise.all([
      this.storedLanguage(userId),
      this.notifications.preferences(userId),
      this.blocks.listOwnBlocks(userId, 100),
    ]);

    return {
      // Null is a real answer (BR-040): no default is pre-selected, so an
      // account that has never chosen has no stored language and the client
      // shows its own first-launch choice as current.
      language,
      notifications,
      blockedCount: blocked.length,
    };
  }

  /**
   * SET-FR-004 — delete, with the password re-entered.
   *
   * THE VERIFICATION IS IDENTITY'S, AND THE DECISION IS DELETION'S, and this
   * method is the only place they meet. `settings` never learns how a password
   * is stored, and `DeletionService` has no way to skip the check — it requires
   * the flag, and only a caller that actually asked can set it truthfully.
   */
  async deleteAccount(userId: string, password: string): Promise<DeleteResult> {
    const confirmed = await this.passwords.confirmIdentity(userId, password);
    if (confirmed === null) {
      return { status: 'REFUSED', reason: 'ALREADY_DELETED' };
    }

    return this.deletion.requestDeletion({
      userId,
      state: confirmed.state,
      passwordVerified: confirmed.verified,
    });
  }

  private async storedLanguage(userId: string): Promise<Locale | null> {
    const r = await this.db.query<{ language: Locale | null }>(
      'SELECT language FROM users WHERE id = $1',
      [userId],
    );
    return r.rows[0]?.language ?? null;
  }
}
