import React, { useEffect } from 'react';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
}

export const SEO: React.FC<SEOProps> = ({
  title,
  description,
  keywords,
  image,
  url = "https://zara-ai-assists.netlify.app/"
}) => {
  const defaultTitle = "Zara AI Assistant – Premium GenAI Workspace";
  const defaultDesc = "Zara AI Assistant: A high-end GenAI workspace featuring real-time voice interaction, and academic mastery developed by Mohammed Majeed.";
  const defaultKeywords = "AI assistant, Zara AI, chatbot, AI automation, productivity AI, GenAI workspace";

  useEffect(() => {
    // Update Title
    document.title = title ? `${title} | Zara AI` : defaultTitle;

    // Update Meta Tags
    const updateMeta = (name: string, content: string, attr: 'name' | 'property' = 'name') => {
      let element = document.querySelector(`meta[${attr}="${name}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attr, name);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    updateMeta('description', description || defaultDesc);
    updateMeta('keywords', keywords || defaultKeywords);

    // Open Graph
    updateMeta('og:title', title || defaultTitle, 'property');
    updateMeta('og:description', description || defaultDesc, 'property');
    updateMeta('og:url', url, 'property');
    if (image) updateMeta('og:image', image, 'property');

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', url);
    }

  }, [title, description, keywords, image, url]);

  return null; // This component doesn't render anything
};
