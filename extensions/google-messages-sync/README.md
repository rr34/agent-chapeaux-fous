# Time V3 Google Messages Sync

This unpacked Manifest V3 extension performs an explicit foreground synchronization from an already-paired Google Messages for Web tab into Time V3. It reads the page's rendered conversation history and sends bounded authenticated batches to `/api/correspondence/google-messages-sync`.

## Install in Brave desktop

1. On Time V3's **Correspondence** page, select **Download Messages extension**.
2. Extract `time-v3-google-messages-sync.zip`.
3. Open `brave://extensions` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `time-v3-google-messages-sync` folder.
5. Open and pair `https://messages.google.com/web/`.
6. Open the extension, enter the Time V3 server URL and access token, and save them.
7. Select **Rescan all available history** for the initial import, then select **Synchronize**.

During repository development, the source `extensions/google-messages-sync`
directory can be selected directly instead of downloading and extracting it.

Later runs overlap the prior successful run by two days and replay stable Google message identities safely. A complete-history run can take a long time because Google Messages initially renders only a small recent window and loads older messages in batches.

After connection settings are saved once, ordinary synchronization can be
started from Time V3's **Correspondence** page with **Sync Google Messages**.
The extension checks for that command at least every 30 seconds and reports its
progress back to the page. Keep Brave and the paired Google Messages tab open.

## Data and limitations

The extension imports complete rendered text, direction, source timestamp, sender/recipient presentation, provider delivery state, reactions, attachment type/name descriptors, conversation identity, and the best observable transport classification. Google credentials and pairing state remain in Brave. Attachment `blob:` URLs are page-scoped, so binary attachment bytes are not uploaded.

This is an unofficial DOM integration. It assumes an English Google Messages UI for absolute timestamp parsing. The sync reports messages skipped for missing usable timestamps, and it fails visibly when required page structures disappear. Google can change those structures at any time.

SMS/MMS records are conservatively linked to phone synchronization only when one candidate agrees on direction, complete body, resolved participants, and source time within the web timestamp's declared precision. Ambiguous candidates remain separate.

The access token is retained in Brave extension storage so it does not need to be reentered. Treat the Brave profile as sensitive.
