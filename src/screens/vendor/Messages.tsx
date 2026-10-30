import { InboxList } from '../../components/InboxList';
import { Initial, ThreadView } from '../../components/ThreadView';
import { useApp } from '../../state/context';

/**
 * The salon's messages from customers. A salon answers conversations; it
 * cannot start one, so a customer list never becomes a mailing list (0025).
 */
export function VendorInbox() {
  const { t } = useApp();
  return (
    <InboxList
      title={t.msgInboxTitle}
      subtitle={t.msgVendorInboxSub}
      empty={t.msgVendorInboxEmpty}
      unavailable={t.msgVendorNoSalon}
    />
  );
}

export function VendorThread() {
  const { t, state, isArabic } = useApp();
  const name = state.thread ? (isArabic ? state.thread.nameAr : state.thread.name) : '';
  return (
    <ThreadView
      title={name}
      subtitle={t.msgVendorThreadSub}
      intro=""
      avatar={<Initial text={(name.trim()[0] ?? '·').toUpperCase()} />}
    />
  );
}
