import { EventDetailPage } from '@/components/special-events/EventDetailPage';

// `params` is a Promise in this version of Next and must be awaited — accessing
// it synchronously is the Next 14 contract, not this one.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="p-4 sm:p-6">
      <EventDetailPage eventId={id} />
    </div>
  );
}
