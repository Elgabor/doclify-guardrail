---
title: API Reference
author: Doclify Team
version: 1.0
---

# API Reference

This document describes the public API for the Doclify platform.

## Authentication

All API requests require a valid access token. Include it in the `Authorization` header:

```
Authorization: Bearer <token>
```

## Endpoints

### GET /api/documents

Returns a list of all documents in the workspace.

**Response:**

```json
{
  "documents": [
    { "id": "doc-1", "title": "Getting Started" },
    { "id": "doc-2", "title": "Configuration" }
  ]
}
```

### POST /api/documents

Creates a new document.

**Request body:**

```json
{
  "title": "New Document",
  "content": "# Hello World"
}
```

## Rate Limits

The API allows up to 100 requests per minute per token. Exceeding this limit
returns a `429 Too Many Requests` response.

## Support

For questions, visit [our docs](https://docs.example.com) or open an issue
on [GitHub](https://github.com/example/doclify).
