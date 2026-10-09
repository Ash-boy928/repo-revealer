// Starts embedded Node.js (nodejs-mobile) and pipes its output to logcat.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

static int pipe_fds[2];
static void *log_thread(void *) {
    char buf[2048];
    ssize_t n;
    while ((n = read(pipe_fds[0], buf, sizeof(buf) - 1)) > 0) {
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, "LeoNode", buf);
    }
    return nullptr;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_leotelebot_mobile_BotService_startNodeWithArguments(JNIEnv *env, jobject, jobjectArray args, jobjectArray envs) {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(pipe_fds);
    dup2(pipe_fds[1], 1);
    dup2(pipe_fds[1], 2);
    pthread_t t;
    pthread_create(&t, nullptr, log_thread, nullptr);
    pthread_detach(t);

    jsize ec = env->GetArrayLength(envs);
    for (jsize i = 0; i < ec; i++) {
        auto s = (jstring) env->GetObjectArrayElement(envs, i);
        const char *c = env->GetStringUTFChars(s, nullptr);
        putenv(strdup(c));
        env->ReleaseStringUTFChars(s, c);
    }

    // node::Start needs argv in one contiguous buffer
    jsize argc = env->GetArrayLength(args);
    std::vector<std::string> parts;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto s = (jstring) env->GetObjectArrayElement(args, i);
        const char *c = env->GetStringUTFChars(s, nullptr);
        parts.emplace_back(c);
        total += strlen(c) + 1;
        env->ReleaseStringUTFChars(s, c);
    }
    char *buf = (char *) calloc(total, 1);
    std::vector<char *> argv;
    char *p = buf;
    for (auto &s : parts) {
        memcpy(p, s.c_str(), s.size());
        argv.push_back(p);
        p += s.size() + 1;
    }
    return node::Start((int) argc, argv.data());
}
