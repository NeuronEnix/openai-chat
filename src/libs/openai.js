import { fetchEventSource } from 'fetch-event-source-hperrin'
import process from 'node:process'

export async function getModels() {
    const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
    })

    const responseData = await response.json()

    const models = responseData.data.filter(model => model.id.startsWith('gpt') && !model.id.match(/-\d{4}$/))

    return models
}

class RetriableError extends Error {}
class FatalError extends Error {}

export async function getCompletion(abortController, model, messages, onMessage, onMessageEnd) {
    console.log(model, messages)

    await fetchEventSource('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 1,
            stream: true,
        }),
        signal: abortController.signal,
        async onopen(response) {
            const EventStreamContentType = 'text/event-stream'

            if(response.ok && response.headers.get('content-type') === EventStreamContentType) {
                return // everything's good
            } else if(response.status >= 400 && response.status < 500 && response.status !== 429) {
                let errorMessage = 'Unknown error'

                if(response.headers.get('content-type') === 'application/json') {
                    const responseBody = await response.json()
                    errorMessage = responseBody.error.message
                } else {
                    errorMessage = await response.text()
                }

                abortController.abort()
                onMessageEnd({ error: errorMessage })

                throw new FatalError()
            } else {
                throw new RetriableError()
            }
        },
        onmessage(msg) {
            const parsedMsg = JSON.parse(msg.data)
            parsedMsg.choices.forEach(choice => {
                if(choice.delta.content) {
                    onMessage(choice.delta.content)
                }

                if(choice.finish_reason !== null) {
                    abortController.abort()
                    onMessageEnd({ success: 'Chat completed' })
                    return
                }
            })
        }
    })
}
