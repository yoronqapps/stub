import ClipboardRoom from "@/components/ClipboardRoom";

export default function RoomPage({ params }: { params: { code: string } }) {
  return <ClipboardRoom rawCode={params.code} />;
}
