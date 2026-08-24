import { SearchCoordinator } from "./search-coordinator.mjs";
import { CalendarSearchProvider } from "./providers/calendar-search-provider.mjs";
import { ContactSearchProvider } from "./providers/contact-search-provider.mjs";
import { HistorySearchProvider } from "./providers/history-search-provider.mjs";
import { FileSearchProvider } from "./providers/file-search-provider.mjs";

export function createNativeSearchCoordinator({ store, organizer, ledger }) {
  return new SearchCoordinator({ providers: [
    new CalendarSearchProvider({ store }),
    new ContactSearchProvider({ organizer }),
    new FileSearchProvider({ ledger }),
    new HistorySearchProvider({ ledger }),
  ] });
}
