import asyncio
from ablebackup.api.progress import ProgressHub


def test_subscriber_receives_published_events():
    async def scenario():
        hub = ProgressHub()
        q = hub.subscribe()
        await hub.publish({"type": "a"})
        await hub.publish({"type": "b"})
        first = await asyncio.wait_for(q.get(), timeout=1)
        second = await asyncio.wait_for(q.get(), timeout=1)
        hub.unsubscribe(q)
        return first, second
    first, second = asyncio.run(scenario())
    assert first == {"type": "a"}
    assert second == {"type": "b"}


def test_new_subscriber_gets_history_first():
    async def scenario():
        hub = ProgressHub()
        await hub.publish({"type": "old1"})
        await hub.publish({"type": "old2"})
        q = hub.subscribe()  # subscribes AFTER events were published
        a = await asyncio.wait_for(q.get(), timeout=1)
        b = await asyncio.wait_for(q.get(), timeout=1)
        return a, b
    a, b = asyncio.run(scenario())
    assert a == {"type": "old1"}
    assert b == {"type": "old2"}


def test_multiple_subscribers_each_receive():
    async def scenario():
        hub = ProgressHub()
        q1 = hub.subscribe()
        q2 = hub.subscribe()
        await hub.publish({"type": "x"})
        return (await asyncio.wait_for(q1.get(), 1),
                await asyncio.wait_for(q2.get(), 1))
    r1, r2 = asyncio.run(scenario())
    assert r1 == {"type": "x"} == r2


def test_publish_threadsafe_delivers_to_loop():
    async def scenario():
        hub = ProgressHub()
        loop = asyncio.get_running_loop()
        hub.bind_loop(loop)
        q = hub.subscribe()
        # simulate a worker thread publishing
        await asyncio.to_thread(hub.publish_threadsafe, {"type": "from_thread"})
        return await asyncio.wait_for(q.get(), timeout=1)
    got = asyncio.run(scenario())
    assert got == {"type": "from_thread"}
