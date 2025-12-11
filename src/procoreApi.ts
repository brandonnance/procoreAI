import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

export interface ProcoreProject {
  id: number;
  name: string;
  project_number: string;
  active?: boolean; // 👈 add this
  [key: string]: any;
}

export async function listProjects(
  companyId = PROCORE_COMPANY_ID
): Promise<ProcoreProject[]> {
  const token = await getFreshAccessToken();

  const client = axios.create({
    baseURL: PROCORE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const response = await client.get("/rest/v1.0/projects", {
    params: { company_id: companyId },
  });

  return response.data as ProcoreProject[];
}
