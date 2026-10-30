"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page";
import { AccountSettings } from "@/components/settings/account";
import { UsersSettings } from "@/components/settings/users";
import { AccountsSettings } from "@/components/settings/accounts";
import { OrganizationSettings } from "@/components/settings/organization";
import { AuditLogSettings, SystemSettings } from "@/components/settings/system";
import { ScoringSettings } from "@/components/settings/scoring";
import { WhatsappSettings } from "@/components/settings/whatsapp";
import { PrivacySettings } from "@/components/settings/privacy";
import { AiSettingsPanel } from "@/components/settings/ai";
import { useSession } from "@/lib/session";

function SettingsTabs() {
  const { can, session } = useSession();
  const platformAdmin = !!session?.user.isPlatformAdmin;
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "conta");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="mb-6 overflow-x-auto pb-1">
        <TabsList className="w-max">
          <TabsTrigger value="conta">Conta e segurança</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          {platformAdmin && <TabsTrigger value="contas">Contas</TabsTrigger>}
          <TabsTrigger value="organizacao">Organização</TabsTrigger>
          <TabsTrigger value="pontuacao">Pontuação</TabsTrigger>
          <TabsTrigger value="ia">Inteligência artificial</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          {can("privacy:manage") && <TabsTrigger value="privacidade">Privacidade (LGPD)</TabsTrigger>}
          {can("auditlog:read") && <TabsTrigger value="auditoria">Trilha de auditoria</TabsTrigger>}
          <TabsTrigger value="sistema">Sistema</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="conta">
        <AccountSettings />
      </TabsContent>
      <TabsContent value="usuarios">
        <UsersSettings />
      </TabsContent>
      {platformAdmin && (
        <TabsContent value="contas">
          <AccountsSettings />
        </TabsContent>
      )}
      <TabsContent value="organizacao">
        <OrganizationSettings />
      </TabsContent>
      <TabsContent value="pontuacao">
        <ScoringSettings />
      </TabsContent>
      <TabsContent value="ia">
        <AiSettingsPanel />
      </TabsContent>
      <TabsContent value="whatsapp">
        <WhatsappSettings />
      </TabsContent>
      <TabsContent value="privacidade">
        <PrivacySettings />
      </TabsContent>
      <TabsContent value="auditoria">
        <AuditLogSettings />
      </TabsContent>
      <TabsContent value="sistema">
        <SystemSettings />
      </TabsContent>
    </Tabs>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Conta, equipe, regras da organização, integrações e conformidade." />
      <Suspense>
        <SettingsTabs />
      </Suspense>
    </>
  );
}
