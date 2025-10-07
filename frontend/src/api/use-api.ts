import { ref } from "vue";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { useToast } from "primevue/usetoast";
import { useSessionStore } from "@/stores/session-store";
import { storeToRefs } from "pinia";
import routes from "./routes";
import type { TokensWithUser } from "@/types/api";
import { useRouter } from "vue-router";

const BASE_URL = import.meta.env.VITE_API_URL;
const AXIOS = axios.create({ baseURL: BASE_URL });

type RouteFn = (...args: string[]) => string;

type GetRequestConfig<R> = {
  config?: Omit<AxiosRequestConfig, "method" | "data" | "url">;
  successMessage?: string;
  routeParams?: R;
};
type PostRequestConfig<D, R> = GetRequestConfig<R> & { data: D | null };

export const useApi = <R extends RouteFn>(route: R, skipAuth: boolean = false) => {
  const loading = ref(false);
  const toast = useToast();
  const router = useRouter();

  const sessionStore = useSessionStore();
  const { tokens } = storeToRefs(sessionStore);
  const controller = new AbortController();

  const abort = () => controller.abort();

  const refreshToken = async () => {
    if (!tokens.value) {
      throw new Error("No tokens available to refresh.");
    }

    const refreshConfig: AxiosRequestConfig = {
      method: "GET",
      url: routes.auth.get.refresh(),
      headers: {
        Authorization: `Bearer ${tokens.value?.refresh_token}`,
      },
    };

    try {
      const response = await AXIOS.request<TokensWithUser>(refreshConfig);
      sessionStore.storeSession(response.data);
      return response.data.access_token;
    } catch {
      toast.add({
        severity: "error",
        summary: "Error",
        detail: "Failed to refresh session. Please log in again.",
        life: 5000,
      });
      sessionStore.clearSession();
      router.push("/auth/login");
    }
  };

  const makeRequest = async <T>(
    config: AxiosRequestConfig,
    routeParams?: Parameters<R>,
    successMessage?: string,
  ): Promise<AxiosResponse<T> | null> => {
    loading.value = true;

    const accessToken = tokens.value?.access_token;

    if (!accessToken && !skipAuth) {
      toast.add({
        severity: "error",
        summary: "Error",
        detail: "You need to be logged in to perform this action.",
        life: 5000,
      });
      loading.value = false;
      return null;
    }

    config.url = route(...(routeParams || []));

    config.headers = {
      Authorization: !accessToken ? undefined : `Bearer ${accessToken}`,
      ...config.headers,
    };

    config.signal = controller.signal;

    try {
      const response: AxiosResponse<T> = await AXIOS.request<T>(config);

      if (successMessage) {
        toast.add({
          severity: "success",
          summary: "Success",
          detail: successMessage,
          life: 5000,
        });
      }

      return response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMessage: string =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.message ||
        "An error occurred. Please try again.";

      if (!skipAuth && errorMessage === "Token has expired.") {
        const newAccessToken = await refreshToken();

        if (!newAccessToken) return null;

        const newConfig: AxiosRequestConfig = {
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${newAccessToken}`,
          },
        };
        return makeRequest<T>(newConfig, routeParams, successMessage);
      }

      toast.add({
        severity: "error",
        summary: "Error",
        detail: errorMessage,
        life: 5000,
      });

      return null;
    } finally {
      loading.value = false;
    }
  };

  const get = async <T>(config?: GetRequestConfig<Parameters<R>>) =>
    makeRequest<T>(
      { ...config?.config, method: "GET" },
      config?.routeParams,
      config?.successMessage,
    );

  const post = async <T, D = null>(config: PostRequestConfig<D, Parameters<R>>) =>
    makeRequest<T>(
      { ...config.config, method: "POST", data: config.data },
      config.routeParams,
      config.successMessage,
    );

  const put = async <T, D = null>(config: PostRequestConfig<D, Parameters<R>>) =>
    makeRequest<T>(
      { ...config.config, method: "PUT", data: config.data },
      config.routeParams,
      config.successMessage,
    );

  const patch = async <T, D = null>(config: PostRequestConfig<D, Parameters<R>>) =>
    makeRequest<T>(
      { ...config.config, method: "PATCH", data: config.data },
      config.routeParams,
      config.successMessage,
    );

  const del = async <T>(config: GetRequestConfig<Parameters<R>>) =>
    makeRequest<T>(
      { ...config.config, method: "DELETE" },
      config.routeParams,
      config.successMessage,
    );

  return { loading, get, post, put, patch, del, abort };
};
