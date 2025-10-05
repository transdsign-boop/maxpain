/**
 * Utility to report API errors to the global error display
 */
export function reportApiError(message: string) {
  const event = new CustomEvent('api-error', {
    detail: { message }
  });
  window.dispatchEvent(event);
}

/**
 * Wrapper for fetch that automatically reports errors
 */
export async function monitoredFetch(url: string, options?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      reportApiError(`${options?.method || 'GET'} ${url}: ${response.status} - ${errorText}`);
    }
    
    return response;
  } catch (error: any) {
    reportApiError(`${options?.method || 'GET'} ${url}: ${error.message || 'Network error'}`);
    throw error;
  }
}
