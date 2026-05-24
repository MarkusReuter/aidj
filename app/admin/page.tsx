import { loadLibrary } from '@/lib/library';
import LibraryEditor from './LibraryEditor';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'AIDJ — Library Editor',
};

export default async function AdminPage() {
  const library = await loadLibrary();
  return <LibraryEditor initialLibrary={library} />;
}
