import { InboxList } from '../../components/InboxList';
import { Initial, ThreadView } from '../../components/ThreadView';
import { useApp } from '../../state/context';

/**
 * Saloni's support inbox: what customers sent when the assistant could not
 * help. Administrators answer as "Saloni", and see support threads only —
 * conversations between a customer and a salon are not Saloni's to read.
 */
export function SupportInbox() {
  const { t } = useApp();
  return (
    <InboxList
      title={t.msgSupportInboxTitle}
      subtitle={t.msgSupportInboxSub}
      empty={t.msgSupportInboxEmpty}
      unavailable={t.adminDenied}
    />
  );
}

export function SupportThread() {
  const { t, state, isArabic } = useApp();
  const name = state.thread ? (isArabic ? state.thread.nameAr : state.thread.name) : '';
  return (
    <ThreadView
      title={name}
      subtitle={t.msgSupportThreadSub}
      intro=""
      avatar={<Initial text={(name.trim()[0] ?? '·').toUpperCase()} />}
    />
  );
}
