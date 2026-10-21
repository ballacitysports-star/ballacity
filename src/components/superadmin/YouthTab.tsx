import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChildSafetyPanel } from "@/components/child/ChildSafetyPanel";
import { SharingFeaturesPanel } from "@/components/superadmin/SharingFeaturesPanel";
import { AgePolicyPanel } from "@/components/superadmin/AgePolicyPanel";

/**
 * Youth & age: the review queues (birthday corrections, parental consent, age
 * reviews, guardian requests) sit next to the age-policy settings so support
 * can act on them without leaving the control center.
 */
export function YouthTab() {
  return (
    <Tabs defaultValue="queues">
      <TabsList>
        <TabsTrigger value="queues">Queues</TabsTrigger>
        <TabsTrigger value="policy">Age policy</TabsTrigger>
        <TabsTrigger value="sharing">Sharing features</TabsTrigger>
      </TabsList>
      <TabsContent value="queues" className="pt-3">
        <ChildSafetyPanel />
      </TabsContent>
      <TabsContent value="policy" className="pt-3">
        <AgePolicyPanel />
      </TabsContent>
      <TabsContent value="sharing" className="pt-3">
        <SharingFeaturesPanel />
      </TabsContent>
    </Tabs>
  );
}
