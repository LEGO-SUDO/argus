// /console — redirect to the default tab (LLD Task 171) so the landing tab is
// unambiguous.
import { redirect } from 'next/navigation';

export default function ConsoleIndexPage() {
  redirect('/console/traces');
}
