import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { ProjectShareTeams } from '../../../../components/projects/ProjectShareTeams';
import { ProjectTeamMove } from '../../../../components/projects/ProjectTeamMove';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { buildCatalogMatrix, clientRows, teamFormId } from '../../../../lib/catalog-view';
import { AddWorkTypesForm } from './AddWorkTypesForm';
import { TeamColumnSaveForm } from './TeamColumnSaveForm';
import { RenameWorkTypeForm } from './RenameWorkTypeForm';
import { WorkTypeArchiveToggle } from './WorkTypeArchiveToggle';
import { ImportClientsForm } from './ImportClientsForm';
import { ResyncButton } from './ResyncButton';
import { TeamColumnsProvider, WorkTypeTick } from './TeamColumns';

/**
 * Clients & work types (spec §8). ADMIN only. The catalog is a work-type × team matrix — each
 * team picks the kinds of work it does, and every client of that team shows exactly those —
 * plus the client import and the re-sync safety net. Nothing here changes the desktop apps:
 * the server materializes the selections as ordinary subprojects.
 */
export default async function AdminCatalogPage() {
  const session = await getSession();
  // Not `return null` — see admin/teams/page.tsx for why every page gates on its own.
  if (!session) redirect(refreshBackTo('/admin/catalog'));
  if (session.role !== 'ADMIN') return <Forbidden />;

  const token = session.accessToken;
  const [workTypes, teams, projects] = await Promise.all([
    api.listWorkTypes(token),
    api.listTeams(token),
    // ONE call for every team (ADMIN `allTeams`): a call per team tripped the API throttler once
    // an org had dozens of teams. clientRows joins the team names from the list above.
    api.listProjects(token, { includeArchived: true, allTeams: true }),
  ]);
  const matrix = buildCatalogMatrix(workTypes, teams);
  const clients = clientRows(teams, projects);
  const teamName = new Map(teams.map((t) => [t.id, t.name] as const));

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-text text-[15px] font-semibold">Work types</h2>
          <p className="text-text-secondary text-caption max-w-[70ch]">
            Tick the work types each team does, then save that team&apos;s column. Every client of
            the team gets them as subprojects; unticking archives them (their hours are kept).
          </p>

          <TeamColumnsProvider matrix={matrix}>
            <Card padding="none" className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Work type</Th>
                    {matrix.teams.map((t) => (
                      <Th key={t.id}>
                        {t.name} <span className="tt-numeric">({t.selectedCount})</span>
                      </Th>
                    ))}
                    <Th align="right">Actions</Th>
                  </Tr>
                </THead>
                <Tbody>
                  {matrix.rows.map((row) => (
                    <Tr key={row.workTypeId}>
                      <Td>
                        <span className={row.archived ? 'text-text-secondary' : ''}>
                          {row.name}
                        </span>
                        {row.archived ? (
                          <span className="ml-2">
                            <Badge tone="neutral">Archived</Badge>
                          </span>
                        ) : null}
                      </Td>
                      {row.cells.map((cell) => (
                        <Td key={cell.teamId}>
                          <WorkTypeTick
                            teamId={cell.teamId}
                            workTypeId={row.workTypeId}
                            disabled={row.archived}
                            label={`${row.name} for ${teamName.get(cell.teamId) ?? 'team'}`}
                          />
                        </Td>
                      ))}
                      <Td align="right">
                        <div className="flex items-center justify-end gap-4">
                          <RenameWorkTypeForm id={row.workTypeId} name={row.name} />
                          <WorkTypeArchiveToggle id={row.workTypeId} archived={row.archived} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                  {matrix.rows.length > 0 ? (
                    <Tr>
                      <Td>
                        <span className="text-text-secondary text-caption">Save a column</span>
                      </Td>
                      {matrix.teams.map((t) => (
                        <Td key={t.id}>
                          <TeamColumnSaveForm
                            formId={teamFormId(t.id)}
                            teamId={t.id}
                            teamName={t.name}
                          />
                        </Td>
                      ))}
                      <Td>{null}</Td>
                    </Tr>
                  ) : null}
                </Tbody>
              </Table>
            </Card>
          </TeamColumnsProvider>

          <AddWorkTypesForm />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-text text-[15px] font-semibold">Clients</h2>
          <ImportClientsForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />

          <Card padding="none" className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Client</Th>
                  <Th>Team</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <Tbody>
                {clients.map((c) => (
                  <Tr key={c.id}>
                    <Td>{c.name}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        {teams.length < 2 ? (
                          c.teamName
                        ) : (
                          <ProjectTeamMove
                            id={c.id}
                            projectName={c.name}
                            teamId={c.teamId}
                            teams={teams}
                          />
                        )}
                        {c.teams.slice(1).map((t) => (
                          <Badge key={t.id} tone="neutral">
                            {t.name}
                          </Badge>
                        ))}
                        <ProjectShareTeams
                          id={c.id}
                          homeTeamId={c.teamId}
                          linkedTeamIds={c.teams.map((t) => t.id)}
                          teams={teams}
                        />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        {c.archived ? (
                          <Badge tone="neutral">Archived</Badge>
                        ) : (
                          <Badge tone="good">Active</Badge>
                        )}
                        {c.shared ? <Badge tone="neutral">Shared</Badge> : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-text text-[15px] font-semibold">Re-sync</h2>
          <p className="text-text-secondary text-caption max-w-[70ch]">
            Re-applies every team&apos;s work types to every client. Safe to run at any time; a
            second run changes nothing.
          </p>
          <ResyncButton />
        </section>
      </div>
    </>
  );
}
