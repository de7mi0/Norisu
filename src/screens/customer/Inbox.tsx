import { InboxList } from '../../components/InboxList';
import { useApp } from '../../state/context';

/** The customer's conversations with salons and with Saloni. */
export function Inbox() {
  const { t } = useApp();
  return (
    <InboxList
      title={t.msgInboxTitle}
      subtitle={t.msgInboxSub}
      empty={t.msgInboxEmpty}
      unavailable={t.msgInboxSignedOut}
    />
  );
}
