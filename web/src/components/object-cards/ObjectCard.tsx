import { CalendarEventCard } from "./CalendarEventCard";
import { CalendarRoutineCard } from "./CalendarRoutineCard";
import { CheckInQuestionCard } from "./CheckInQuestionCard";
import { ContactCard } from "./ContactCard";
import { FileCard } from "./FileCard";
import { InvoiceCard } from "./InvoiceCard";
import { JournalEntryCard } from "./JournalEntryCard";
import { JournalGroupCard } from "./JournalGroupCard";
import { JournalTrackerCard } from "./JournalTrackerCard";
import { LibraryGroupCard } from "./LibraryGroupCard";
import { LibraryItemCard } from "./LibraryItemCard";
import { ProfileFactCard } from "./ProfileFactCard";
import { SimpleObjectCard } from "./SimpleObjectCard";
import { TodoCard } from "./TodoCard";
import { TodoGroupCard } from "./TodoGroupCard";
import type { ObjectCardProps } from "./types";
import { VideoScriptCard } from "./VideoScriptCard";

export function ObjectCard(props: ObjectCardProps) {
  switch (props.object.type) {
    case "contacts.contact": return <ContactCard {...props} />;
    case "todos.todo_group": return <TodoGroupCard {...props} />;
    case "todos.personal_task": return <TodoCard {...props} />;
    case "payments.invoice": return <InvoiceCard {...props} />;
    case "journal.group": return <JournalGroupCard {...props} />;
    case "journal.tracker": return <JournalTrackerCard {...props} />;
    case "journal.entry": return <JournalEntryCard {...props} />;
    case "calendar.event": return <CalendarEventCard {...props} />;
    case "calendar.routine": return <CalendarRoutineCard {...props} />;
    case "files.file": return <FileCard {...props} />;
    case "profile.fact": return <ProfileFactCard {...props} />;
    case "catch_up.question": return <CheckInQuestionCard {...props} />;
    case "video.script": return <VideoScriptCard {...props} />;
    case "video.content_group": return <LibraryGroupCard {...props} />;
    case "video.content_item": return <LibraryItemCard {...props} />;
    default: return <SimpleObjectCard {...props} />;
  }
}

export type { ObjectCardModel, ObjectCardProps } from "./types";
