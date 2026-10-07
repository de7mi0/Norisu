import { Photo } from '../../components/Photo';
import { Initial, ThreadView } from '../../components/ThreadView';
import { useApp } from '../../state/context';

/**
 * A customer's conversation with a salon, or with Saloni's team.
 *
 * This used to answer itself: every message got "a team member will confirm
 * the details shortly" after a second, and nobody had read it. Now the salon's
 * owner reads it in their portal and replies here (0025).
 */
export function Chat() {
  const { t, state, isArabic, salons } = useApp();
  const current = state.thread;
  const isSupport = !current?.salonId;
  const salon = salons.find((candidate) => candidate.id === current?.salonId);
  const name = current ? (isArabic ? current.nameAr : current.name) : '';

  return (
    <ThreadView
      title={isSupport ? t.msgSupportName : name}
      subtitle={isSupport ? t.msgSupportSub : t.msgSalonSub}
      intro={isSupport ? t.msgIntroSupport : t.msgIntroSalon}
      avatar={
        salon ? (
          <Photo
            src={salon.photo}
            tile={salon.tile}
            style={{ width: 40, height: 40, flex: 'none', borderRadius: '50%' }}
          />
        ) : (
          <Initial text={isSupport ? 'S' : (name.trim()[0] ?? '·')} dark={isSupport} />
        )
      }
    />
  );
}
