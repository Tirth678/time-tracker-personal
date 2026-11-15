import { Suspense } from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import StudyApp from "@/components/StudyApp";

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <StudyApp />
    </Suspense>
  );
}
