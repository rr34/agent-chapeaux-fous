import { SearchCoordinator } from "./search-coordinator.mjs";
import { CalendarSearchProvider } from "./providers/calendar-search-provider.mjs";
import { ContactSearchProvider } from "./providers/contact-search-provider.mjs";
import { HistorySearchProvider } from "./providers/history-search-provider.mjs";
import { FileSearchProvider } from "./providers/file-search-provider.mjs";
import { EmailSearchProvider } from "./providers/email-search-provider.mjs";
import { NativeObjectDomainSearchProvider } from "./providers/native-object-domain-search-provider.mjs";

export const nativeObjectSearchDomains = Object.freeze([
  ["todos", "Native to-do groups and personal tasks.", ["todos.todo_group", "todos.personal_task"]],
  ["things", "Native physical-item groups and possessions.", ["things.physical_item_group", "things.physical_item"]],
  ["journal", "Native journal groups, trackers, and entries.", ["journal.group", "journal.tracker", "journal.entry"]],
  ["content", "Native content-library groups and items.", ["video.content_group", "video.content_item"]],
  ["video", "Native source-grounded video scripts.", ["video.script"]],
  ["profile", "Native durable profile facts and preferences.", ["profile.fact"]],
  ["catch_up", "Native unresolved Check-in questions.", ["catch_up.question"]],
  ["payments", "Native prepared and sent payment invoices.", ["payments.invoice"]],
]);

export function createNativeSearchCoordinator({ store, organizer, ledger }) {
  return new SearchCoordinator({ providers: [
    new CalendarSearchProvider({ store, organizer }),
    new ContactSearchProvider({ organizer }),
    new FileSearchProvider({ ledger }),
    new HistorySearchProvider({ ledger }),
    ...nativeObjectSearchDomains.map(([id, description, domainTypes]) => new NativeObjectDomainSearchProvider({
      id, description, organizer, domainTypes,
    })),
    new NativeObjectDomainSearchProvider({
      id: "objects",
      description: "Searchable first-class native objects.",
      organizer,
      global: false,
    }),
  ] });
}

export function registerEmailSearchProvider(searchCoordinator, client) {
  searchCoordinator.register(new EmailSearchProvider({ client }));
  return searchCoordinator;
}
