import { Badge, Box, Button, Card, Dialog, Flex, Heading, Text, TextArea, TextField } from "@radix-ui/themes";
import { memo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AnnouncementCard } from "./putzopticon/Announcement";
import { CenterSpinner } from "../utils/spinner";
import { formatET, fromET, getRelativeTime, toET } from "../utils/time";

// Admin panel: announcements for the Putzopticon. Write them ahead of time, then Show puts one up
// on the TV full-screen right away (or Schedule has it go up on its own at a time in ET), and Hide
// takes it down.

// Match convex/announcements.ts.
const MAX_LENGTH = 280;
const MAX_DETAILS_LENGTH = 500;

type Draft = { text: string; details?: string };

// Keeps the line breaks as typed, and breaks a long word or link rather than widening the page.
const WRAPPED = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

// A TV-shaped (9:16) preview of how it'll look.
const TVPreview = memo(({ text, details, width }: Draft & { width: number }) => (
  <Box
    flexShrink="0"
    position="relative"
    overflow="hidden"
    style={{ width, aspectRatio: "9 / 16", borderRadius: 4, border: "1px solid var(--gray-6)" }}
  >
    {text.trim() ? (
      <AnnouncementCard text={text.trim()} details={details?.trim() || undefined} preview />
    ) : (
      <Flex height="100%" align="center" justify="center">
        <Text size="1" color="gray">
          Preview
        </Text>
      </Flex>
    )}
  </Box>
));

const Editor = memo(
  ({ initial, submitLabel, onSubmit }: { initial?: Draft; submitLabel: string; onSubmit: (draft: Draft) => Promise<unknown> }) => {
    const [text, setText] = useState(initial?.text ?? "");
    const [details, setDetails] = useState(initial?.details ?? "");
    const [saving, setSaving] = useState(false);
    const trimmed = text.trim();
    const unchanged = trimmed === (initial?.text ?? "").trim() && details.trim() === (initial?.details ?? "").trim();
    return (
      <Flex gap="4" align={{ initial: "stretch", sm: "start" }} direction={{ initial: "column", sm: "row" }}>
        <Flex direction="column" gap="2" flexGrow="1" minWidth="0">
          <Text size="2" weight="bold">
            Headline
          </Text>
          <TextArea
            rows={3}
            value={text}
            maxLength={MAX_LENGTH}
            placeholder="As big as it'll go. Press Enter to choose exactly where lines break."
            onChange={(e) => setText(e.target.value)}
          />
          <Text size="1" color="gray" align="right">
            {trimmed.length}/{MAX_LENGTH}
          </Text>
          <Text size="2" weight="bold">
            Smaller text <Text weight="regular" color="gray">(optional)</Text>
          </Text>
          <TextArea
            rows={4}
            value={details}
            maxLength={MAX_DETAILS_LENGTH}
            placeholder="A few sentences underneath, e.g. the details."
            onChange={(e) => setDetails(e.target.value)}
          />
          <Flex justify="between" align="center" gap="3">
            <Text size="1" color="gray">
              {details.trim() ? details.trim().split(/\s+/).length : 0} words, {details.trim().length}/{MAX_DETAILS_LENGTH}
            </Text>
            <Button
              disabled={!trimmed || saving || unchanged}
              loading={saving}
              onClick={() => {
                setSaving(true);
                onSubmit({ text: trimmed, details: details.trim() })
                  .then(() => {
                    setText("");
                    setDetails("");
                  })
                  .catch(alert)
                  .finally(() => setSaving(false));
              }}
            >
              {submitLabel}
            </Button>
          </Flex>
        </Flex>
        <Flex justify="center">
          <TVPreview text={text} details={details} width={150} />
        </Flex>
      </Flex>
    );
  }
);

// Picks when it goes up, on the house's clock (ET) whatever time zone the browser is in.
const Scheduler = memo(({ initial, onSubmit }: { initial?: number; onSubmit: (at: number) => Promise<unknown> }) => {
  // Defaults to the top of the next hour.
  const [start] = useState(() => toET(initial ?? Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000));
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [saving, setSaving] = useState(false);
  const at = date && time ? fromET(date, time) : NaN;
  const past = at <= Date.now();
  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" align="center" wrap="wrap">
        <TextField.Root type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "1 1 130px", minWidth: 0 }} />
        <TextField.Root type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: "1 1 100px", minWidth: 0 }} />
        <Text size="2" color="gray">
          ET
        </Text>
      </Flex>
      <Text size="2" color={past ? "red" : "gray"}>
        {Number.isNaN(at) ? "Pick a date and time." : past ? "That's in the past." : `Goes up ${formatET(at)}.`}
      </Text>
      <Flex justify="end">
        <Button
          disabled={Number.isNaN(at) || past || saving}
          loading={saving}
          onClick={() => {
            setSaving(true);
            onSubmit(at)
              .catch(alert)
              .finally(() => setSaving(false));
          }}
        >
          Schedule
        </Button>
      </Flex>
    </Flex>
  );
});

export const AdminAnnouncements = memo(() => {
  const announcements = useQuery(api.announcements.list);
  const create = useMutation(api.announcements.create);
  const edit = useMutation(api.announcements.edit);
  const remove = useMutation(api.announcements.remove);
  const show = useMutation(api.announcements.show);
  const hide = useMutation(api.announcements.hide);
  const schedule = useMutation(api.announcements.schedule);
  const unschedule = useMutation(api.announcements.unschedule);

  const [previewing, setPreviewing] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<(Draft & { id: Id<"announcements"> }) | null>(null);
  const [scheduling, setScheduling] = useState<{ id: Id<"announcements">; at?: number } | null>(null);
  const live = announcements?.find((a) => a.live);

  return (
    <>
      <Flex justify="between" align="center" mb="4" gap="3" wrap="wrap">
        <Heading size={{ initial: "7", sm: "8" }}>Announcements</Heading>
        {live && (
          <Button color="red" variant="solid" onClick={() => hide().catch(alert)}>
            Hide from TV
          </Button>
        )}
      </Flex>

      <Text as="p" size="2" color="gray" mb="3">
        Shown full-screen on the Putzopticon, flashing, until hidden. Show puts one up now; Schedule has it go up
        on its own at a time in ET. Only admins can see this list.
      </Text>

      <Box mb="4">
        <Editor submitLabel="Add" onSubmit={(draft) => create(draft)} />
      </Box>

      {!announcements ? (
        <CenterSpinner />
      ) : announcements.length === 0 ? (
        <Text color="gray">None yet.</Text>
      ) : (
        // A card each, not a table: on a phone the text goes on top and the buttons wrap underneath.
        <Flex direction="column" gap="2">
          {announcements.map((a) => (
            <Card key={a._id}>
              <Flex gap="3" justify="between" direction={{ initial: "column", sm: "row" }} align={{ initial: "stretch", sm: "center" }}>
                <Flex direction="column" gap="1" align="start" minWidth="0">
                  {a.live && <Badge color="red">On the TV now</Badge>}
                  {a.scheduledFor && <Badge color="blue">Goes up {formatET(a.scheduledFor)}</Badge>}
                  <Text style={WRAPPED}>{a.text}</Text>
                  {a.details && (
                    <Text size="2" color="gray" style={WRAPPED}>
                      {a.details}
                    </Text>
                  )}
                  <Text color="gray" size="1">
                    {a.createdBy}, {getRelativeTime(a.createdAt)}
                  </Text>
                </Flex>
                <Flex
                  gap="2"
                  wrap="wrap"
                  flexShrink="0"
                  justify={{ initial: "start", sm: "end" }}
                  maxWidth={{ initial: "100%", sm: "350px" }}
                >
                  {a.live ? (
                    <Button color="red" variant="solid" onClick={() => hide().catch(alert)}>
                      Hide
                    </Button>
                  ) : (
                    <Button
                      color="red"
                      variant="soft"
                      onClick={() => {
                        if (confirm("Put this up on the Putzopticon now?")) show({ id: a._id }).catch(alert);
                      }}
                    >
                      Show
                    </Button>
                  )}
                  {!a.live && (
                    <Button variant="soft" color="blue" onClick={() => setScheduling({ id: a._id, at: a.scheduledFor })}>
                      {a.scheduledFor ? "Reschedule" : "Schedule"}
                    </Button>
                  )}
                  {a.scheduledFor && (
                    <Button variant="soft" color="gray" onClick={() => unschedule({ id: a._id }).catch(alert)}>
                      Unschedule
                    </Button>
                  )}
                  <Button variant="soft" color="gray" onClick={() => setPreviewing({ text: a.text, details: a.details })}>
                    Preview
                  </Button>
                  <Button variant="soft" color="gray" onClick={() => setEditing({ id: a._id, text: a.text, details: a.details })}>
                    Edit
                  </Button>
                  <Button
                    variant="soft"
                    color="gray"
                    onClick={() => {
                      if (confirm("Delete this announcement?")) remove({ id: a._id }).catch(alert);
                    }}
                  >
                    Delete
                  </Button>
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}

      <Dialog.Root open={previewing !== null} onOpenChange={(open) => !open && setPreviewing(null)}>
        <Dialog.Content maxWidth="370px">
          <Dialog.Title>Preview</Dialog.Title>
          <Flex justify="center">{previewing && <TVPreview {...previewing} width={300} />}</Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={scheduling !== null} onOpenChange={(open) => !open && setScheduling(null)}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>Schedule announcement</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="3">
            It goes up on the Putzopticon on its own at this time, replacing whatever is showing, and stays up until hidden.
          </Dialog.Description>
          {scheduling && (
            <Scheduler
              key={scheduling.id}
              initial={scheduling.at}
              onSubmit={(at) => schedule({ id: scheduling.id, at }).then(() => setScheduling(null))}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <Dialog.Content maxWidth="640px">
          <Dialog.Title>Edit announcement</Dialog.Title>
          {editing && (
            <Editor
              key={editing.id}
              initial={editing}
              submitLabel="Save"
              onSubmit={(draft) => edit({ id: editing.id, ...draft }).then(() => setEditing(null))}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
});
