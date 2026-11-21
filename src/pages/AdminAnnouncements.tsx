import { Badge, Box, Button, Dialog, Flex, Heading, Table, Text, TextArea } from "@radix-ui/themes";
import { memo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AnnouncementCard } from "./putzopticon/Announcement";
import { CenterSpinner } from "../utils/spinner";
import { getRelativeTime } from "../utils/time";

// Admin panel: announcements for the Putzopticon. Write them ahead of time, then Show puts one up
// on the TV full-screen right away, and Hide takes it down.

// Match convex/announcements.ts.
const MAX_LENGTH = 280;
const MAX_DETAILS_LENGTH = 500;

type Draft = { text: string; details?: string };

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
        <Flex direction="column" gap="2" flexGrow="1">
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
          <Flex justify="between" align="center">
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

export const AdminAnnouncements = memo(() => {
  const announcements = useQuery(api.announcements.list);
  const create = useMutation(api.announcements.create);
  const edit = useMutation(api.announcements.edit);
  const remove = useMutation(api.announcements.remove);
  const show = useMutation(api.announcements.show);
  const hide = useMutation(api.announcements.hide);

  const [previewing, setPreviewing] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<(Draft & { id: Id<"announcements"> }) | null>(null);
  const live = announcements?.find((a) => a.live);

  return (
    <>
      <Flex justify="between" align="center" mb="4" gap="3">
        <Heading size="8">Announcements</Heading>
        {live && (
          <Button color="red" variant="solid" onClick={() => hide().catch(alert)}>
            Hide from TV
          </Button>
        )}
      </Flex>

      <Text as="p" size="2" color="gray" mb="3">
        Shown full-screen on the Putzopticon, flashing, until hidden. Only admins can see this list.
      </Text>

      <Box mb="4">
        <Editor submitLabel="Add" onSubmit={(draft) => create(draft)} />
      </Box>

      {!announcements ? (
        <CenterSpinner />
      ) : announcements.length === 0 ? (
        <Text color="gray">None yet.</Text>
      ) : (
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Text</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Added</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {announcements.map((a) => (
              <Table.Row key={a._id} align="center">
                <Table.Cell>
                  <Flex direction="column" gap="1" align="start">
                    {a.live && <Badge color="red">On the TV now</Badge>}
                    <Text style={{ whiteSpace: "pre-wrap" }}>{a.text}</Text>
                    {a.details && (
                      <Text size="2" color="gray" style={{ whiteSpace: "pre-wrap" }}>
                        {a.details}
                      </Text>
                    )}
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <Text color="gray" size="2">
                    {a.createdBy}, {getRelativeTime(a.createdAt)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Flex gap="2" wrap="wrap" justify="end">
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
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      <Dialog.Root open={previewing !== null} onOpenChange={(open) => !open && setPreviewing(null)}>
        <Dialog.Content maxWidth="370px">
          <Dialog.Title>Preview</Dialog.Title>
          <Flex justify="center">{previewing && <TVPreview {...previewing} width={300} />}</Flex>
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
